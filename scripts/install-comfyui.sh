#!/usr/bin/env bash
# Installs the toolchain that bakes Kaylee's face: ComfyUI, CPU-only torch, the AdvancedLivePortrait
# node and the six models it reads. One-time and idempotent: every step prints `ran` or `skip`, a
# step whose result is already there is skipped, and nothing is deleted. What a run replaces is
# install.json.previous (the old install.json is renamed over it) and a model that failed its sha256.
#
# Where: COMPANION_COMFYUI_DIR (default /opt/comfyui, where this box keeps its third-party installs).
# The folder holds a venv and multi-gigabyte models, so it lives outside the tracked tree, and the
# estate backup treats its parts differently:
#   - the venv holds `pyvenv.cfg`, so the night records it as a pip freeze and the restore replays
#     that with a plain `pip install -r`. torch is installed by wheel URL for that reason: its freeze
#     line is `torch @ https://download.pytorch.org/…`, which resolves anywhere, where
#     `torch==2.13.0+cpu` resolves only on the CPU index;
#   - ComfyUI/models holds CACHEDIR.TAG, so `restic --exclude-caches` skips it;
#   - the two code checkouts and install.json are carried as they are.
# The way back after a restore is the restore's own venv rebuild, then this script again: it fetches
# the models and finds everything else done.
#
# Why the models are fetched here: the node would download face_yolov8n.pt on a first run, and a
# bake must run offline and the same every time. Each model lands as `<name>.part` and moves into
# place only once its sha256 matches the one Hugging Face publishes, so a cut-off run finishes on
# the next one. install.json is written last: its presence means the whole toolchain is there, and a
# run that is about to change anything first sets the old one aside as install.json.previous.
set -euo pipefail

# --- what is installed: named constants, the one place any of it changes ---------------------------
COMFYUI_URL="https://github.com/comfyanonymous/ComfyUI"
COMFYUI_TAG="v0.43.1"
COMFYUI_COMMIT="086099f5d8886163ef77dc354f8382cb7431582a"
NODE_NAME="ComfyUI-AdvancedLivePortrait"
NODE_URL="https://github.com/PowerHouseMan/ComfyUI-AdvancedLivePortrait"
NODE_COMMIT="3bba732915e22f18af0d221b9c5c282990181f1b"

# The default CUDA build costs gigabytes for nothing on a box with no GPU; these three wheels come
# from the CPU index and are the only torch the constraints file lets any later step leave in place.
TORCH_INDEX="https://download.pytorch.org/whl/cpu"
TORCH_VERSION="2.13.0"
TORCHVISION_VERSION="0.28.0"
TORCHAUDIO_VERSION="2.11.1"
TORCH_WHEEL_TAG="cp312-cp312-manylinux_2_28_x86_64" # torch and torchvision; torchaudio is pure python
TORCHAUDIO_WHEEL_TAG="py3-none-manylinux_2_28_x86_64"
TORCH_WHEELS=(
  "$TORCH_INDEX/torch-$TORCH_VERSION%2Bcpu-$TORCH_WHEEL_TAG.whl"
  "$TORCH_INDEX/torchvision-$TORCHVISION_VERSION%2Bcpu-$TORCH_WHEEL_TAG.whl"
  "$TORCH_INDEX/torchaudio-$TORCHAUDIO_VERSION%2Bcpu-$TORCHAUDIO_WHEEL_TAG.whl"
)

LIVEPORTRAIT_URL="https://huggingface.co/Kijai/LivePortrait_safetensors/resolve/main"
YOLO_URL="https://huggingface.co/Bingsu/adetailer/resolve/main"
# <path under ComfyUI/models> <sha256, as Hugging Face publishes it for the file>
MODELS=(
  "liveportrait/appearance_feature_extractor.safetensors 38bef5de50a92bf1fc66e8c511051a19dfacdf80c37f8713425ec15dc9ca7d34"
  "liveportrait/motion_extractor.safetensors 3568cd410e29d046771acb55ecfdfe4c7c197d345bd8b7f95942ef63130b6c9e"
  "liveportrait/warping_module.safetensors f7b7834bd6039b4088f72e5161e60ad366f68a3763df8a3eac0bc0f9d46fdbbf"
  "liveportrait/spade_generator.safetensors ca04fbec765745e9eae836d2d7522c274647b277ce5f25104fa1705b75222212"
  "liveportrait/stitching_retargeting_module.safetensors 60725cf3523ae413880da28ed583c9e84c5c25695a0cef1b77210ea31cc424ea"
  "ultralytics/face_yolov8n.pt 70b640f8f60b1cf0dcc72f30caf3da9495eb2fb6509da48c53374ad6806e6a9c"
)
CACHEDIR_SIGNATURE="Signature: 8a477f597d28d172789f06886806bc55"

# --- output --------------------------------------------------------------------------------------
fail() { echo "install-comfyui: $*" >&2; exit 1; }
ran() { printf 'ran   %s\n' "$*"; }
skipped() { printf 'skip  %s\n' "$*"; }

sha256_of() {
  local out
  out=$(sha256sum -- "$1")
  printf '%s\n' "${out%% *}"
}

# An install.json that names what a run is about to change is false from that moment: it is set
# aside (renamed, never deleted) before the first change, and a finished run writes a new one.
retire_install_json() {
  [ ! -f "$DIR/install.json" ] || mv -f "$DIR/install.json" "$DIR/install.json.previous"
}

# --- steps ---------------------------------------------------------------------------------------
preflight() {
  local tool libs python_tag
  for tool in git curl flock sha256sum python3; do
    command -v "$tool" >/dev/null || fail "$tool is required and is not installed."
  done
  python3 -c 'import venv, ensurepip' 2>/dev/null || fail "python3 has no venv module; install python3-venv."
  python_tag=$(python3 -c 'import sys; print(f"cp{sys.version_info[0]}{sys.version_info[1]}")')
  case "$TORCH_WHEEL_TAG" in
    "$python_tag-$python_tag-"*"_$(uname -m)") ;;
    *) fail "the torch wheels this script names are $TORCH_WHEEL_TAG; this box is $python_tag on $(uname -m)." ;;
  esac
  # ultralytics pulls the full opencv-python beside the headless build the node asks for, and its
  # import needs libGL; better a sentence now than an ImportError from inside a bake. ldconfig is in
  # sbin, which a service's or cron's PATH leaves out.
  libs=$(PATH="$PATH:/usr/sbin:/sbin" ldconfig -p 2>/dev/null || true)
  case "$libs" in *libGL.so.1*) ;; *) fail "libGL.so.1 is missing and opencv's import needs it; install libgl1." ;; esac
}

ensure_folder() {
  if [ -d "$DIR" ]; then
    [ -w "$DIR" ] || fail "$DIR is not writable by $(id -un)."
    skipped "folder $DIR"
    return
  fi
  if [ -w "$(dirname "$DIR")" ]; then
    install -d "$DIR"
  else
    sudo -n install -d -o "$(id -un)" -g "$(id -gn)" "$DIR" || fail "could not create $DIR with sudo."
  fi
  ran "folder $DIR created, owned by $(id -un)"
}

# A git run killed hard (SIGKILL, power cut) leaves its lock file in the checkout, and git then
# refuses every later run. The script deletes nothing, so it names the file for its owner to remove.
lock_hint() {
  local locks
  locks=$(compgen -G "$1/.git/*.lock" || true)
  [ -z "$locks" ] || printf ' A lock left by a run killed hard blocks git: %s. Remove it and run again.' "${locks//$'\n'/, }"
}

# checkout_pinned <dir> <ref> <commit> [--force]: <ref> is a tag name or a full commit hash. A tag is
# kept under refs/tags, so `git describe` names it from the folder. git gets a deadline: it ends a
# stalled transfer after a minute and the whole fetch after fifteen. A ref that now names another
# commit is refused rather than followed.
checkout_pinned() {
  local dir=$1 ref=$2 commit=$3 refspec=$2 got code=0
  [[ $ref =~ ^[0-9a-f]{40}$ ]] || refspec="+refs/tags/$ref:refs/tags/$ref"
  GIT_HTTP_LOW_SPEED_LIMIT=1024 GIT_HTTP_LOW_SPEED_TIME=60 timeout 900 \
    git -C "$dir" fetch --quiet --depth 1 origin "$refspec" || code=$?
  [ "$code" -eq 0 ] || fail "git could not fetch $ref from $(git -C "$dir" remote get-url origin) (exit $code); the network may be down.$(lock_hint "$dir")"
  got=$(git -C "$dir" rev-parse 'FETCH_HEAD^{commit}')
  [ "$got" = "$commit" ] || fail "$ref upstream is now ${got:0:12}, not the ${commit:0:12} this script names."
  git -C "$dir" checkout --quiet --detach ${4:+"$4"} "$commit" ||
    fail "git could not check out ${commit:0:12} in $dir.$(lock_hint "$dir")"
}

# pin_repository <dir> <url> <ref> <commit> <label>: a shallow checkout of <commit>, built in a part
# directory of its own and renamed into place. A run killed hard can leave a git lock in its part
# directory, so no run reuses another's; an abandoned one is only a stray `.<name>.part.*` here.
pin_repository() {
  local dir=$1 url=$2 ref=$3 commit=$4 label=$5 head tagged part
  part="$DIR/.$(basename "$dir").part.$(date +%s).$$"
  if [ -d "$dir/.git" ]; then
    head=$(git -C "$dir" rev-parse HEAD)
    tagged=$(git -C "$dir" rev-parse -q --verify "refs/tags/$ref^{commit}" 2>/dev/null || true)
    if [ "$head" = "$commit" ] && { [ "$tagged" = "$commit" ] || [[ $ref =~ ^[0-9a-f]{40}$ ]]; }; then
      skipped "$label at ${commit:0:12}"
      return
    fi
    retire_install_json
    checkout_pinned "$dir" "$ref" "$commit"
    if [ "$head" = "$commit" ]; then
      ran "$label tag recorded at ${commit:0:12}"
    else
      ran "$label moved from ${head:0:12} to ${commit:0:12}"
    fi
    return
  fi
  [ ! -e "$dir" ] || [ -z "$(ls -A "$dir")" ] || fail "$dir exists and is not a git checkout; move it aside and run again."
  retire_install_json
  git init --quiet "$part"
  git -C "$part" remote add origin "$url"
  checkout_pinned "$part" "$ref" "$commit" --force
  mv -T "$part" "$dir"
  ran "$label cloned at ${commit:0:12}"
}

installed_version() {
  "$PY" -I -c 'import importlib.metadata as metadata, sys
try:
    print(metadata.version(sys.argv[1]))
except metadata.PackageNotFoundError:
    pass' "$1"
}

# The URL a package was installed from (pip records it in direct_url.json), or nothing.
installed_url() {
  "$PY" -I -c 'import importlib.metadata as metadata, json, sys
try:
    text = metadata.distribution(sys.argv[1]).read_text("direct_url.json")
except metadata.PackageNotFoundError:
    text = None
print(json.loads(text)["url"] if text else "")' "$1"
}

pip_install() {
  "$PY" -m pip install --no-input --constraint "$CONSTRAINTS" "$@"
}

# pip_step <what> <pip install args…>: pip quiet; a failure names the step and shows pip's last lines.
pip_step() {
  local what=$1 out
  shift
  out=$(pip_install "$@" 2>&1) ||
    fail "pip failed while installing $what (the network may be down); its last lines:"$'\n'"$(tail -n 12 <<<"$out")"
}

ensure_venv() {
  if "$PY" -m pip --version >/dev/null 2>&1; then
    skipped "venv $DIR/venv"
  else
    retire_install_json
    python3 -m venv "$DIR/venv"
    ran "venv created with python $("$PY" -c 'import platform; print(platform.python_version())')"
  fi
  printf 'torch==%s+cpu\ntorchvision==%s+cpu\ntorchaudio==%s+cpu\n' \
    "$TORCH_VERSION" "$TORCHVISION_VERSION" "$TORCHAUDIO_VERSION" >"$CONSTRAINTS"
}

# True when all three are installed from their wheel URLs (pip records the origin in direct_url.json).
torch_wheels_current() {
  local names=(torch torchvision torchaudio) index
  for index in 0 1 2; do
    [ "$(installed_url "${names[index]}")" = "${TORCH_WHEELS[index]}" ] || return 1
  done
}

# Installed from their wheel URLs, not as `torch==2.13.0+cpu` from the index: see the header. pip
# keeps an installed torch of the same version when asked for its URL, so a venv built from the
# index is moved over by a forced reinstall of just the three.
ensure_torch() {
  local what="torch $TORCH_VERSION+cpu, torchvision $TORCHVISION_VERSION+cpu, torchaudio $TORCHAUDIO_VERSION+cpu"
  if torch_wheels_current; then
    skipped "$what"
    return
  fi
  retire_install_json
  pip_step "torch, torchvision and torchaudio from $TORCH_INDEX" "${TORCH_WHEELS[@]}"
  torch_wheels_current || pip_step "torch, torchvision and torchaudio from $TORCH_INDEX" --force-reinstall --no-deps "${TORCH_WHEELS[@]}"
  ran "$what installed by wheel URL"
}

# ensure_requirements <requirements file> <label>: pip's own resolver says whether the file is
# already satisfied (`--dry-run` prints "Would install" only when it is not), so the answer comes
# from what is in the venv and not from a stamp that could outlive it.
ensure_requirements() {
  local file=$1 label=$2 plan
  plan=$(pip_install --dry-run -r "$file" 2>&1) || fail "pip could not resolve $file:"$'\n'"$plan"
  if grep -q '^Would install' <<<"$plan"; then
    retire_install_json
    pip_step "the $label requirements" -r "$file"
    ran "$label requirements installed"
  else
    skipped "$label requirements"
  fi
}

ensure_cachedir_tag() {
  local tag="$MODELS_DIR/CACHEDIR.TAG"
  if [ -f "$tag" ] && grep -q "^$CACHEDIR_SIGNATURE" "$tag"; then
    skipped "models/CACHEDIR.TAG"
    return
  fi
  printf '%s\n# This file is a cache directory tag created by scripts/install-comfyui.sh.\n# For information about cache directory tags, see https://bford.info/cachedir/\n' \
    "$CACHEDIR_SIGNATURE" >"$tag"
  ran "models/CACHEDIR.TAG written, so the backup leaves the models out"
}

# download <url> <part file> [fresh]: continues the part file where a cut-off run stopped, unless
# asked to start over. A transfer that stalls under 1 KB/s for a minute is a failure.
download() {
  local resume=(--continue-at -)
  [ "${3:-}" != fresh ] || resume=()
  curl --fail --location --silent --show-error --retry 3 --retry-delay 2 --connect-timeout 20 \
    --speed-limit 1024 --speed-time 60 "${resume[@]}" --output "$2" "$1"
}

# fetch_verified <url> <dest> <sha256>: <dest>.part is moved to <dest> only once it matches.
fetch_verified() {
  local url=$1 dest=$2 want=$3 part="$2.part" got="" code=0
  mkdir -p "$(dirname "$dest")"
  [ ! -f "$part" ] || got=$(sha256_of "$part") # a cut-off run may have fetched every byte
  if [ "$got" != "$want" ]; then
    download "$url" "$part" || code=$?
    # 22 and 33 are the server refusing to continue from a part that is no prefix of its file; that
    # starts over below. Any other failure is the network, and the part stays for the next run.
    case "$code" in 0 | 22 | 33) ;; *) fail "could not download $url (curl exit $code)$([ ! -f "$part" ] || echo "; the next run continues from $part")." ;; esac
    got=""
    [ "$code" -ne 0 ] || got=$(sha256_of "$part")
  fi
  if [ "$got" != "$want" ]; then # the bytes kept from an earlier run were bad: once from byte zero
    download "$url" "$part" fresh || fail "could not download $url."
    got=$(sha256_of "$part")
  fi
  [ "$got" = "$want" ] || fail "$url has sha256 $got, not the $want this script names; left at $part."
  mv -f "$part" "$dest"
}

model_url() {
  case "$1" in
    liveportrait/*) printf '%s/%s\n' "$LIVEPORTRAIT_URL" "${1#*/}" ;;
    ultralytics/*) printf '%s/%s\n' "$YOLO_URL" "${1#*/}" ;;
    *) fail "no source is named for $1." ;;
  esac
}

ensure_model() {
  local rel=$1 want=$2 dest="$MODELS_DIR/$1" got=""
  [ ! -f "$dest" ] || got=$(sha256_of "$dest")
  if [ "$got" = "$want" ]; then
    skipped "models/$rel, sha256 matches"
  else
    retire_install_json
    fetch_verified "$(model_url "$rel")" "$dest" "$want"
    ran "models/$rel downloaded, sha256 ${want:0:12}"
  fi
  MODEL_SHA[$rel]=$want
}

# What this install is, read back from the folder and not from the constants above. A failure here
# exits the substitution it runs in, which stops the script: errexit does not reach inside it.
render_install_json() {
  local entry rel tag pairs=()
  tag=$(git -C "$COMFY_DIR" describe --tags --exact-match HEAD) || fail "$COMFY_DIR is at no tag."
  for entry in "${MODELS[@]}"; do
    rel=${entry%% *}
    pairs+=("$rel=${MODEL_SHA[$rel]}=$(stat -c %s "$MODELS_DIR/$rel")")
  done
  python3 -I - "$tag" "$(git -C "$COMFY_DIR" rev-parse HEAD)" "$NODE_NAME" "$(git -C "$NODE_DIR" rev-parse HEAD)" \
    "$(installed_version torch)" "$(installed_version torchvision)" "$(installed_version torchaudio)" \
    "${pairs[@]}" <<'PY'
import json, sys
tag, commit, node, node_commit, torch, torchvision, torchaudio, *models = sys.argv[1:]
print(json.dumps({
    "comfyui": {"tag": tag, "commit": commit},
    "node": {"name": node, "commit": node_commit},
    "torch": {"torch": torch, "torchvision": torchvision, "torchaudio": torchaudio},
    "models": [dict(zip(("path", "sha256", "bytes"), (p, s, int(b)))) for p, s, b in (m.split("=") for m in models)],
    "installer": "scripts/install-comfyui.sh",
}, indent=2))
PY
}

# Written last, and only after the toolchain imports: its presence means the whole install is there.
write_install_json() {
  local target="$DIR/install.json" wanted imports
  wanted=$(render_install_json)
  if [ -f "$target" ] && [ "$(cat "$target")" = "$wanted" ]; then
    skipped "install.json"
    return
  fi
  imports=$("$PY" -I -c 'import torch, torchvision, torchaudio, cv2, timm, albumentations, ultralytics' 2>&1) ||
    fail "the installed packages do not import; install.json is not written:"$'\n'"$imports"
  printf '%s\n' "$wanted" >"$target.part"
  mv -f "$target.part" "$target"
  ran "install.json written"
}

main() {
  DIR="${COMPANION_COMFYUI_DIR:-/opt/comfyui}"
  DIR="${DIR%/}"
  case "$DIR" in /?*) ;; *) fail "COMPANION_COMFYUI_DIR must be an absolute path other than /; got '$DIR'." ;; esac
  COMFY_DIR="$DIR/ComfyUI"
  NODE_DIR="$COMFY_DIR/custom_nodes/$NODE_NAME"
  MODELS_DIR="$COMFY_DIR/models"
  PY="$DIR/venv/bin/python"
  CONSTRAINTS="$DIR/venv/torch-constraints.txt"
  declare -gA MODEL_SHA=()
  export PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_PROGRESS_BAR=off

  preflight
  ensure_folder
  # A second run waits for the first and then finds every step done.
  exec 9>>"$DIR/.install.lock"
  flock 9

  pin_repository "$COMFY_DIR" "$COMFYUI_URL" "$COMFYUI_TAG" "$COMFYUI_COMMIT" "ComfyUI $COMFYUI_TAG"
  # Tagged before the first model lands, so no backup can carry them in between.
  ensure_cachedir_tag
  ensure_venv
  ensure_torch
  ensure_requirements "$COMFY_DIR/requirements.txt" "ComfyUI"
  mkdir -p "$COMFY_DIR/custom_nodes"
  pin_repository "$NODE_DIR" "$NODE_URL" "$NODE_COMMIT" "$NODE_COMMIT" "$NODE_NAME"
  ensure_requirements "$NODE_DIR/requirements.txt" "$NODE_NAME"
  local entry
  for entry in "${MODELS[@]}"; do
    ensure_model "${entry%% *}" "${entry#* }"
  done
  write_install_json
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
