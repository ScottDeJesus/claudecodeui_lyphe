/* @ds-bundle: {"format":4,"namespace":"VerveDesignSystem_845c78","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"AvatarStack","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"EmptyState","sourcePath":"components/core/EmptyState.jsx"},{"name":"Skeleton","sourcePath":"components/core/Skeleton.jsx"},{"name":"Spinner","sourcePath":"components/core/Spinner.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"DatePicker","sourcePath":"components/data/DatePicker.jsx"},{"name":"Sparkline","sourcePath":"components/data/Sparkline.jsx"},{"name":"DryingGauge","sourcePath":"components/domain/DryingGauge.jsx"},{"name":"DryingTrend","sourcePath":"components/domain/DryingTrend.jsx"},{"name":"StatusFlow","sourcePath":"components/domain/StatusFlow.jsx"},{"name":"Timeline","sourcePath":"components/domain/Timeline.jsx"},{"name":"TrustPosture","sourcePath":"components/domain/TrustPosture.jsx"},{"name":"TrustSettings","sourcePath":"components/domain/TrustSettings.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"RadioGroup","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Slider","sourcePath":"components/forms/Slider.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"TextArea","sourcePath":"components/forms/TextArea.jsx"},{"name":"Composer","sourcePath":"components/messaging/Composer.jsx"},{"name":"Thread","sourcePath":"components/messaging/Thread.jsx"},{"name":"Pagination","sourcePath":"components/navigation/Pagination.jsx"},{"name":"Stepper","sourcePath":"components/navigation/Stepper.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Banner","sourcePath":"components/overlays/Banner.jsx"},{"name":"Menu","sourcePath":"components/overlays/Menu.jsx"},{"name":"Modal","sourcePath":"components/overlays/Modal.jsx"},{"name":"Sheet","sourcePath":"components/overlays/Sheet.jsx"},{"name":"Toast","sourcePath":"components/overlays/Toast.jsx"},{"name":"ToastStack","sourcePath":"components/overlays/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/overlays/Tooltip.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"f67457124658","components/core/Badge.jsx":"2357d234d545","components/core/Button.jsx":"63a0c09a4ff5","components/core/Card.jsx":"6dffe8a12d45","components/core/Chip.jsx":"003a8a0c3c35","components/core/EmptyState.jsx":"87a97e31710e","components/core/Skeleton.jsx":"e7cf00a037d6","components/core/Spinner.jsx":"05c851c8c692","components/data/DataTable.jsx":"6a7bbfd91153","components/data/DatePicker.jsx":"a2d08eb50fd0","components/data/Sparkline.jsx":"1ea01f2710b2","components/domain/DryingGauge.jsx":"e3edc70f5e39","components/domain/DryingTrend.jsx":"9eef27125dac","components/domain/StatusFlow.jsx":"5f08c788d16b","components/domain/Timeline.jsx":"f5891ca40202","components/domain/TrustPosture.jsx":"14885a1dd04b","components/domain/TrustSettings.jsx":"d14b4df37364","components/forms/Checkbox.jsx":"73be2729fe1e","components/forms/Field.jsx":"92d500f40f46","components/forms/Input.jsx":"5e246b2c9cd2","components/forms/Radio.jsx":"9dbb08c3f138","components/forms/Select.jsx":"cfab6925e1b1","components/forms/Slider.jsx":"b586cff03e11","components/forms/Switch.jsx":"5a22484fa04c","components/forms/TextArea.jsx":"52ad3481879e","components/messaging/Composer.jsx":"673aab0bb41a","components/messaging/Thread.jsx":"848bf35c6dc5","components/navigation/Pagination.jsx":"3f9ab7ac3e1e","components/navigation/Stepper.jsx":"ef36424db67e","components/navigation/Tabs.jsx":"6ce4e1359c5d","components/overlays/Banner.jsx":"355a59e536e4","components/overlays/Menu.jsx":"e925e3235927","components/overlays/Modal.jsx":"bf4846e258ca","components/overlays/Sheet.jsx":"eeee9d4315f8","components/overlays/Toast.jsx":"e6573535fe7c","components/overlays/Tooltip.jsx":"7137b5d72d1c","ui_kits/console/screens.jsx":"1b85f54d0767","ui_kits/console/shell.jsx":"0650dc235a75"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.VerveDesignSystem_845c78 = window.VerveDesignSystem_845c78 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
const grads = ["linear-gradient(135deg,#2fa876,#6fd0a8)", "linear-gradient(135deg,#e0713a,#f0a172)", "linear-gradient(135deg,#3aa6b9,#6fd0a8)"];
function Avatar({
  initials = "",
  hue = 0,
  size = 36,
  overflow,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      background: overflow ? "var(--surface2)" : grads[hue % grads.length],
      border: "2px solid var(--surface)",
      color: overflow ? "var(--ink-muted)" : "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: size * 0.36,
      fontWeight: 700,
      boxSizing: "border-box",
      flex: "none",
      ...style
    }
  }, overflow || initials);
}
function AvatarStack({
  people = [],
  max = 3,
  size = 36
}) {
  const shown = people.slice(0, max),
    extra = people.length - shown.length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex"
    }
  }, shown.map((p, i) => /*#__PURE__*/React.createElement(Avatar, {
    key: i,
    initials: p.initials,
    hue: p.hue ?? i,
    size: size,
    style: i ? {
      marginLeft: -10
    } : {}
  })), extra > 0 && /*#__PURE__*/React.createElement(Avatar, {
    overflow: "+" + extra,
    size: size,
    style: {
      marginLeft: -10
    }
  }));
}
Object.assign(__ds_scope, { Avatar, AvatarStack });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function Badge({
  tone = "neutral",
  style,
  children
}) {
  const t = tone === "positive" ? "pos" : tone;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-block",
      padding: "4px 12px",
      borderRadius: 999,
      background: `var(--${t}-soft)`,
      color: `var(--${t}-ink)`,
      fontSize: 12.5,
      fontWeight: 500,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
const pal = {
  primary: {
    background: "var(--accent)",
    color: "#fff",
    border: "none"
  },
  tonal: {
    background: "var(--accent-soft)",
    color: "var(--accent-ink)",
    border: "none"
  },
  outline: {
    background: "none",
    color: "var(--ink)",
    border: "1.5px solid var(--border-strong)"
  },
  ghost: {
    background: "none",
    color: "var(--accent)",
    border: "none"
  },
  danger: {
    background: "var(--danger)",
    color: "#fff",
    border: "none"
  }
};
const hov = {
  primary: {
    background: "var(--accent-deep)",
    boxShadow: "0 8px 22px rgba(47,168,118,.35)"
  },
  tonal: {
    background: "var(--accent-soft-hover)",
    boxShadow: "0 8px 20px rgba(47,168,118,.22)"
  },
  outline: {
    borderColor: "var(--accent)",
    boxShadow: "0 8px 20px rgba(32,26,20,.12)"
  },
  ghost: {
    background: "var(--accent-soft)"
  },
  danger: {
    background: "var(--danger-deep)"
  }
};
function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  onClick,
  style,
  children
}) {
  const [h, setH] = React.useState(false),
    [a, setA] = React.useState(false);
  if (disabled) return /*#__PURE__*/React.createElement("button", {
    disabled: true,
    style: {
      background: "var(--surface2)",
      color: "var(--ink-faint)",
      border: "none",
      padding: size === "sm" ? "7px 16px" : "11px 22px",
      borderRadius: 10,
      fontFamily: "var(--font-body)",
      fontWeight: 500,
      fontSize: size === "sm" ? 13 : 15,
      cursor: "not-allowed",
      opacity: .7,
      ...style
    }
  }, children);
  const scale = variant === "ghost" ? {} : {
    transform: a ? "scale(.92)" : h ? "scale(1.06)" : "none"
  };
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => {
      setH(false);
      setA(false);
    },
    onMouseDown: () => setA(true),
    onMouseUp: () => setA(false),
    style: {
      ...pal[variant],
      padding: size === "sm" ? variant === "outline" ? "6px 14px" : "7px 16px" : variant === "outline" ? "10px 20px" : variant === "ghost" ? "11px 14px" : "11px 22px",
      borderRadius: 10,
      fontFamily: "var(--font-body)",
      fontWeight: 500,
      fontSize: size === "sm" ? 13 : 15,
      cursor: "pointer",
      transition: "transform .5s var(--ease-press),background .2s,border-color .2s,box-shadow .35s",
      ...scale,
      ...(h ? hov[variant] : {}),
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function Card({
  eyebrow,
  title,
  hover = true,
  onClick,
  style,
  children
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: 20,
      transition: "transform .4s var(--ease-enter),box-shadow .4s",
      cursor: onClick ? "pointer" : "default",
      ...(hover && h ? {
        transform: "translateY(-5px)",
        boxShadow: "var(--shadow-lift)"
      } : {}),
      ...style
    }
  }, eyebrow && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "var(--ink-faint)",
      marginBottom: 8
    }
  }, eyebrow), title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 17,
      marginBottom: 6
    }
  }, title), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
function Chip({
  selected = false,
  onClick,
  style,
  children
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: selected ? {
      padding: "7px 15px",
      borderRadius: 999,
      background: "var(--accent-soft)",
      color: "var(--accent-ink)",
      fontSize: 13.5,
      fontWeight: 500,
      cursor: onClick ? "pointer" : "default",
      display: "inline-block",
      ...style
    } : {
      padding: "7px 15px",
      borderRadius: 999,
      border: "1.5px solid " + (h ? "var(--accent)" : "var(--border-strong)"),
      color: "var(--ink-mid)",
      fontSize: 13.5,
      fontWeight: 500,
      cursor: onClick ? "pointer" : "default",
      transition: "border-color .2s",
      display: "inline-block",
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/core/EmptyState.jsx
try { (() => {
function EmptyState({
  title = "Nothing here yet",
  message,
  actionLabel,
  onAction,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1.5px dashed var(--border-strong)",
      borderRadius: 12,
      padding: "34px 24px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      textAlign: "center",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 24,
      color: "var(--ink-faint)",
      fontStyle: "italic"
    }
  }, title), message && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-faint)",
      maxWidth: 260,
      lineHeight: 1.5
    }
  }, message), actionLabel && /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "tonal",
    onClick: onAction,
    style: {
      marginTop: 8
    }
  }, actionLabel));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/core/Skeleton.jsx
try { (() => {
function Skeleton({
  width = "100%",
  height = 14,
  radius = 6,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "vv-skeleton",
    style: {
      width,
      height,
      borderRadius: radius,
      ...style
    }
  });
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/core/Spinner.jsx
try { (() => {
function Spinner({
  size = 44,
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      border: "4px solid var(--surface2)",
      borderTopColor: "var(--accent)",
      animation: "vv-spin 1s linear infinite,vv-spin-hue 2.4s ease-in-out infinite",
      boxSizing: "border-box"
    }
  }), label && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-faint)"
    }
  }, label));
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function DataTable({
  columns = [],
  rows = [],
  onRowClick,
  style
}) {
  const [sort, setSort] = React.useState({
    key: null,
    dir: 1
  });
  const sorted = React.useMemo(() => {
    if (!sort.key) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.key],
        y = b[sort.key];
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
  }, [rows, sort]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: 12,
      overflow: "hidden",
      ...style
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontFamily: "var(--font-body)"
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: "var(--canvas)"
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    onClick: () => c.sortable !== false && setSort(s => ({
      key: c.key,
      dir: s.key === c.key ? -s.dir : 1
    })),
    style: {
      padding: "11px 16px",
      fontSize: 12,
      letterSpacing: ".08em",
      textTransform: "uppercase",
      color: sort.key === c.key ? "var(--accent-ink)" : "var(--ink-faint)",
      fontWeight: 700,
      cursor: c.sortable === false ? "default" : "pointer",
      textAlign: "left",
      borderBottom: "1px solid var(--border)"
    }
  }, c.label, " ", sort.key === c.key && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9
    }
  }, sort.dir === 1 ? "▲" : "▼"))))), /*#__PURE__*/React.createElement("tbody", null, sorted.map((r, ri) => /*#__PURE__*/React.createElement("tr", {
    key: ri,
    onClick: () => onRowClick && onRowClick(r),
    onMouseEnter: e => e.currentTarget.style.background = "var(--accent-soft)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    style: {
      cursor: onRowClick ? "pointer" : "default",
      transition: "background .15s"
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      padding: "12px 16px",
      fontSize: 14,
      color: c.muted ? "var(--ink-muted)" : "var(--ink)",
      fontWeight: c.muted ? 400 : 500,
      borderBottom: ri < sorted.length - 1 ? "1px solid var(--surface2)" : "none",
      fontVariantNumeric: c.tabular ? "tabular-nums" : "normal"
    }
  }, c.render ? c.render(r) : r[c.key])))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/DatePicker.jsx
try { (() => {
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function DatePicker({
  month = "August 2026",
  days = 31,
  startDow = 6,
  selected,
  onSelect,
  style
}) {
  const cells = [...Array(startDow).fill(null), ...Array.from({
    length: days
  }, (_, i) => i + 1)];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 252,
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: 16,
      background: "var(--surface)",
      boxSizing: "content-box",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 14
    }
  }, month), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, ["◀", "▶"].map(a => /*#__PURE__*/React.createElement("div", {
    key: a,
    style: {
      width: 26,
      height: 26,
      borderRadius: 8,
      background: "var(--surface2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 11,
      color: "var(--ink-muted)",
      cursor: "pointer"
    }
  }, a)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(7,1fr)",
      gap: 2
    }
  }, DOW.map(d => /*#__PURE__*/React.createElement("div", {
    key: d,
    style: {
      textAlign: "center",
      fontSize: 10.5,
      color: "var(--ink-faint)",
      fontWeight: 700,
      padding: "4px 0"
    }
  }, d)), cells.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onClick: () => d && onSelect && onSelect(d),
    style: {
      height: 28,
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12.5,
      cursor: d ? "pointer" : "default",
      background: d === selected ? "var(--accent)" : "transparent",
      color: d === selected ? "#fff" : d ? "var(--ink)" : "transparent",
      fontWeight: d === selected ? 700 : 400,
      transition: "background .15s"
    },
    onMouseEnter: e => {
      if (d && d !== selected) e.currentTarget.style.background = "var(--surface2)";
    },
    onMouseLeave: e => {
      if (d !== selected) e.currentTarget.style.background = "transparent";
    }
  }, d || ""))));
}
Object.assign(__ds_scope, { DatePicker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DatePicker.jsx", error: String((e && e.message) || e) }); }

// components/data/Sparkline.jsx
try { (() => {
function Sparkline({
  values = [],
  width = 200,
  height = 72,
  color = "var(--accent)",
  fill = "var(--accent-soft)"
}) {
  if (!values.length) return null;
  const hi = Math.max(...values),
    lo = Math.min(...values),
    span = hi - lo || 1;
  const pts = values.map((v, i) => [+(i * (width / (values.length - 1))).toFixed(1), +((1 - (v - lo) / span) * (height - 8) + 4).toFixed(1)]);
  const line = pts.map(p => p.join(",")).join(" ");
  const last = pts[pts.length - 1];
  return /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    style: {
      overflow: "visible"
    }
  }, /*#__PURE__*/React.createElement("polygon", {
    points: `${line} ${last[0]},${height} 0,${height}`,
    fill: fill
  }), /*#__PURE__*/React.createElement("polyline", {
    points: line,
    fill: "none",
    stroke: color,
    strokeWidth: "2",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: last[0],
    cy: last[1],
    r: "4",
    fill: color,
    stroke: "var(--surface)",
    strokeWidth: "2"
  }));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/domain/DryingGauge.jsx
try { (() => {
/* Counter-intuitive on purpose: value = % DRIED. Full water means soaked, empty means done.
   value null/undefined = UNKNOWN: no water drawn, bare em-dash, no % sign. Never render unknown as 0%. */
function DryingGauge({
  value = null,
  size = 96,
  label,
  note,
  tooltip,
  fan = true,
  style
}) {
  const unknown = value === null || value === undefined;
  const level = unknown ? 0 : 100 - value; // water = what remains
  const tip = tooltip || (unknown ? "No usable moisture readings yet" : value + "% dried — " + level + "% to go");
  const chip = size <= 28;
  const gauge = /*#__PURE__*/React.createElement("div", {
    title: tip,
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      border: (chip ? "1px" : "1.5px") + " solid var(--border)",
      background: "var(--surface)",
      position: "relative",
      overflow: "hidden",
      cursor: "help",
      flex: "none",
      boxSizing: "border-box"
    }
  }, !unknown && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: level + "%",
      background: "linear-gradient(180deg,rgba(58,166,185,.5),rgba(58,166,185,.3))",
      transition: "height 2s cubic-bezier(.35,1.12,.4,1)"
    }
  }, !chip && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: -size * 2.56,
      left: -size * 0.81,
      width: size * 2.67,
      height: size * 2.67,
      background: "var(--surface)",
      borderRadius: "46%",
      animation: "vv-swirl 11s linear infinite"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: -size * 2.57,
      left: -size * 0.9,
      width: size * 2.67,
      height: size * 2.67,
      background: "var(--surface)",
      borderRadius: "48%",
      opacity: .55,
      animation: "vv-swirl 17s linear infinite reverse"
    }
  }))), fan && !chip && /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 40 40",
    style: {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: size * 0.96,
      height: size * 0.96,
      margin: -size * 0.48 + "px 0 0 " + -size * 0.48 + "px",
      opacity: .2,
      animation: "vv-swirl 1.6s linear infinite"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "20",
    cy: "20",
    r: "2.6",
    fill: "var(--ink-faint)"
  }), [0, 120, 240].map(r => /*#__PURE__*/React.createElement("path", {
    key: r,
    d: "M20 18 C14 12 15 5 20 4 C25 5 26 12 20 18 Z",
    fill: "var(--ink-faint)",
    transform: `rotate(${r} 20 20)`
  }))), !chip && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontVariantNumeric: "tabular-nums",
      fontFamily: "var(--font-body)",
      fontWeight: 700,
      fontSize: size * 0.21,
      color: unknown ? "var(--ink-faint)" : "var(--ink)"
    }
  }, unknown ? "—" : value + "%"));
  if (chip) return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "5px 12px 5px 6px",
      borderRadius: 999,
      border: "1px solid var(--border)",
      background: "var(--canvas)",
      ...style
    }
  }, gauge, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 700,
      fontVariantNumeric: "tabular-nums",
      color: unknown ? "var(--ink-faint)" : "var(--ink)"
    }
  }, unknown ? "—" : value + "%"), label && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-faint)"
    }
  }, label));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 9,
      width: size + 36,
      ...style
    }
  }, gauge, label && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700
    }
  }, label), note && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-faint)",
      textAlign: "center",
      lineHeight: 1.5
    }
  }, note));
}
Object.assign(__ds_scope, { DryingGauge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/DryingGauge.jsx", error: String((e && e.message) || e) }); }

// components/domain/DryingTrend.jsx
try { (() => {
/* Sparkline of moisture readings. Goal + projection are optional layers; scale always widens to include them. */
function DryingTrend({
  values = [],
  goal = null,
  projection = null,
  goalLabel,
  footerLeft,
  footerRight,
  width = 260,
  height = 76,
  style
}) {
  if (!values.length) return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: 12,
      background: "var(--canvas)",
      padding: "16px 18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width,
      minHeight: height + 24,
      boxSizing: "content-box",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--ink-faint)"
    }
  }, "No readings yet"));
  const all = values.concat(goal !== null ? [goal] : [], projection !== null ? [projection] : []);
  const hi = Math.max(...all) + 6,
    lo = Math.min(...all) - 4;
  const X = i => +(i * (width / (values.length - 1 + (projection !== null ? 2 : 0)))).toFixed(1);
  const Y = v => +((1 - (v - lo) / (hi - lo)) * (height - 8) + 4).toFixed(1);
  const pts = values.map((v, i) => [X(i), Y(v)]);
  const line = pts.map(p => p.join(",")).join(" ");
  const last = pts[pts.length - 1];
  const projX = projection !== null ? X(values.length + 1) : 0,
    projY = projection !== null ? Y(projection) : 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--border)",
      borderRadius: 12,
      background: "var(--canvas)",
      padding: "16px 18px 12px",
      boxSizing: "border-box",
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    style: {
      overflow: "visible",
      display: "block"
    }
  }, /*#__PURE__*/React.createElement("polygon", {
    points: `${line} ${last[0]},${height} 0,${height}`,
    fill: "rgba(58,166,185,.14)"
  }), goal !== null && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: Y(goal),
    x2: width,
    y2: Y(goal),
    stroke: "var(--ink-faint)",
    strokeWidth: "1",
    strokeDasharray: "4 4"
  }), /*#__PURE__*/React.createElement("text", {
    x: "2",
    y: Y(goal) - 5,
    fontSize: "10",
    fontWeight: "700",
    fill: "var(--ink-muted)",
    stroke: "var(--surface)",
    strokeWidth: "3",
    paintOrder: "stroke",
    fontFamily: "Schibsted Grotesk,sans-serif"
  }, goalLabel || goal + "% goal")), projection !== null && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
    points: `${last.join(",")} ${projX},${projY}`,
    fill: "none",
    stroke: "var(--water)",
    strokeWidth: "1.5",
    strokeDasharray: "4 4"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: projX,
    cy: projY,
    r: "4",
    fill: "var(--canvas)",
    stroke: "var(--water)",
    strokeWidth: "1.5"
  })), /*#__PURE__*/React.createElement("polyline", {
    points: line,
    fill: "none",
    stroke: "var(--water)",
    strokeWidth: "2",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), pts.map((p, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: p[0],
    cy: p[1],
    r: i === pts.length - 1 ? 4 : 2.5,
    fill: i === pts.length - 1 ? "var(--water)" : "var(--canvas)",
    stroke: "var(--water)",
    strokeWidth: "1.5"
  }))), (footerLeft || footerRight) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 12,
      color: "var(--ink-muted)",
      marginTop: 8,
      fontVariantNumeric: "tabular-nums"
    }
  }, /*#__PURE__*/React.createElement("span", null, footerLeft), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: "var(--ink)"
    }
  }, footerRight)));
}
Object.assign(__ds_scope, { DryingTrend });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/DryingTrend.jsx", error: String((e && e.message) || e) }); }

// components/domain/StatusFlow.jsx
try { (() => {
/* The job's lifecycle rail. Node states: done, current, future, evidence (evidenced island —
   check mark but the connector behind it stays UNFILLED: the record is real, continuity would be a lie). */
const nodeStyle = st => st === "done" || st === "evidence" ? {
  background: "var(--accent)",
  color: "#fff",
  border: "1.5px solid var(--accent)",
  mark: "✓"
} : st === "current" ? {
  background: "var(--surface)",
  color: "var(--accent)",
  border: "1.5px solid var(--accent)",
  mark: "●"
} : {
  background: "var(--surface)",
  color: "var(--ink-faint)",
  border: "1.5px solid var(--border-strong)",
  mark: ""
};
const lineFor = (stages, i) => {
  const cont = stages.slice(0, i + 1).every(x => x.state === "done" || x.state === "current");
  return cont && stages[i].state !== "future" ? "2px solid var(--accent)" : "2px dashed var(--border-strong)";
};
function StatusFlow({
  stages = [],
  layout = "horizontal",
  alsoOnFile,
  terminal,
  style
}) {
  const [prov, setProv] = React.useState(null),
    [alsoProv, setAlsoProv] = React.useState(null);
  if (terminal) return /*#__PURE__*/React.createElement("div", {
    style: {
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: "4px 12px",
      borderRadius: 999,
      background: "var(--neutral-soft)",
      color: "var(--neutral-ink)",
      fontSize: 12.5,
      fontWeight: 500
    }
  }, terminal.badge || "Not sold"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 500
    }
  }, terminal.label, terminal.date && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-faint)"
    }
  }, " \xB7 ", terminal.date))), terminal.provenance && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 12.5,
      color: "var(--ink-muted)"
    }
  }, terminal.provenance));
  if (layout === "vertical") return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      ...style
    }
  }, stages.map((st, i) => {
    const n = nodeStyle(st.state);
    return /*#__PURE__*/React.createElement("div", {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => st.provenance && setProv(p => p === i ? null : i),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: st.provenance ? "pointer" : "default",
        padding: "2px 0"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 22,
        height: 22,
        borderRadius: "50%",
        boxSizing: "border-box",
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700,
        background: n.background,
        color: n.color,
        border: n.border,
        animation: st.state === "current" ? "vv-ring 2.4s ease-out infinite" : "none"
      }
    }, n.mark), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        fontSize: 13.5,
        fontWeight: 500,
        color: st.state === "future" ? "var(--ink-faint)" : "var(--ink)"
      }
    }, st.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-faint)",
        fontVariantNumeric: "tabular-nums"
      }
    }, st.date || "—")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 22,
        display: "flex",
        justifyContent: "center",
        flex: "none"
      }
    }, i < stages.length - 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        width: 0,
        height: prov === i && st.provenance ? "auto" : 14,
        minHeight: 14,
        borderLeft: lineFor(stages, i)
      }
    })), prov === i && st.provenance && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: "var(--ink-muted)",
        padding: "2px 0 8px",
        animation: "vv-fade .25s ease both"
      }
    }, st.provenance)));
  }), alsoOnFile && alsoOnFile.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      letterSpacing: ".1em",
      textTransform: "uppercase",
      color: "var(--ink-faint)",
      marginBottom: 8
    }
  }, "Also on file \xB7 ", alsoOnFile.length), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, alsoOnFile.map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => a.provenance && setAlsoProv(p => p === i ? null : i),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "4px 0",
      cursor: a.provenance ? "pointer" : "default"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "var(--accent)",
      opacity: .6,
      flex: "none"
    }
  }, "\u2713"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      color: "var(--ink-mid)"
    }
  }, a.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--ink-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, a.date)), alsoProv === i && a.provenance && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-muted)",
      padding: "0 0 6px 20px",
      animation: "vv-fade .25s ease both"
    }
  }, a.provenance))))));
  // horizontal — provenance renders once beneath the whole track
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      overflowX: "auto",
      paddingBottom: 4
    }
  }, stages.map((st, i) => {
    const n = nodeStyle(st.state);
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "flex-start",
        flex: i < stages.length - 1 ? 1 : "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => st.provenance && setProv(p => p === i ? null : i),
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        cursor: st.provenance ? "pointer" : "default",
        minWidth: 52
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 24,
        height: 24,
        borderRadius: "50%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        background: n.background,
        color: n.color,
        border: n.border,
        animation: st.state === "current" ? "vv-ring 2.4s ease-out infinite" : "none",
        transition: "transform .3s var(--ease-spring)"
      }
    }, n.mark), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 500,
        color: st.state === "current" ? "var(--ink)" : st.state === "future" ? "var(--ink-faint)" : "var(--ink-mid)",
        whiteSpace: "nowrap"
      }
    }, st.abbr || st.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10.5,
        color: "var(--ink-faint)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap"
      }
    }, st.date || "—")), i < stages.length - 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        height: 0,
        borderTop: lineFor(stages, i),
        margin: "12px 4px 0",
        minWidth: 14
      }
    }));
  })), prov !== null && stages[prov] && stages[prov].provenance && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      fontSize: 12.5,
      color: "var(--ink-muted)",
      background: "var(--canvas)",
      border: "1px solid var(--border)",
      borderRadius: 9,
      padding: "8px 13px",
      display: "inline-block",
      animation: "vv-fade .25s ease both"
    }
  }, stages[prov].provenance));
}
Object.assign(__ds_scope, { StatusFlow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/StatusFlow.jsx", error: String((e && e.message) || e) }); }

// components/domain/Timeline.jsx
try { (() => {
/* Chronological feed stitched from six sources. Warn is the MOST COMMON tone — it must stay calm.
   Hard rules: no expanded row may ever be empty (neutral-grey fallback line), and a cancelled visit is amber/neutral, never red. */
function Timeline({
  events = [],
  density = "full",
  openIndex,
  onToggle,
  style
}) {
  const [internalOpen, setInternalOpen] = React.useState(null);
  const open = openIndex !== undefined ? openIndex : internalOpen;
  const toggle = i => onToggle ? onToggle(i) : setInternalOpen(o => o === i ? null : i);
  const dense = density === "dense";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      ...style
    }
  }, events.map((e, i) => {
    const t = e.tone === "positive" ? "pos" : e.tone || "neutral";
    const isOpen = open === i;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        borderBottom: i < events.length - 1 ? "1px solid var(--surface2)" : "none"
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => toggle(i),
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: dense ? "8px 2px" : "11px 2px",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: `var(--${t}-dot)`,
        marginTop: 6,
        flex: "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: 999,
        background: "var(--surface2)",
        color: "var(--ink-muted)",
        flex: "none",
        marginTop: 0
      }
    }, e.source), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: dense ? 13 : 13.5,
        fontWeight: 500,
        whiteSpace: dense ? "nowrap" : "normal",
        overflow: dense ? "hidden" : "visible",
        textOverflow: "ellipsis"
      }
    }, e.title), !dense && e.summary && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12.5,
        color: "var(--ink-muted)",
        marginTop: 1
      }
    }, e.summary), !dense && e.thumbs && !isOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        marginTop: 6
      }
    }, e.thumbs.slice(0, 4).map((th, j) => /*#__PURE__*/React.createElement("div", {
      key: j,
      style: {
        width: 28,
        height: 28,
        borderRadius: 6,
        background: th.bg || "var(--surface2)"
      }
    })))), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)",
        flex: "none",
        fontVariantNumeric: "tabular-nums"
      }
    }, e.when), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: "var(--ink-faint)",
        flex: "none",
        transform: isOpen ? "rotate(180deg)" : "none",
        transition: "transform .3s var(--ease-enter)",
        display: "inline-block",
        marginTop: 2
      }
    }, "\u25BC")), isOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: "0 2px 12px 28px",
        animation: "vv-fade .25s ease both"
      }
    }, e.cancelBadge && /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        background: "var(--warn-soft)",
        color: "var(--warn-ink)",
        fontSize: 12,
        fontWeight: 500,
        marginBottom: 8
      }
    }, "Cancelled"), e.quote && /*#__PURE__*/React.createElement("div", {
      style: {
        borderLeft: "2px solid var(--border)",
        paddingLeft: 12,
        fontSize: 13.5,
        color: "var(--ink-mid)",
        lineHeight: 1.6,
        whiteSpace: "pre-line",
        marginBottom: 8
      }
    }, e.quote), e.thumbs && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 8,
        flexWrap: "wrap"
      }
    }, e.thumbs.map((th, j) => /*#__PURE__*/React.createElement("div", {
      key: j,
      style: {
        width: 48,
        height: 48,
        borderRadius: 8,
        background: th.bg || "var(--surface2)"
      }
    }))), e.chips && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 8,
        flexWrap: "wrap"
      }
    }, e.chips.map(c => /*#__PURE__*/React.createElement("span", {
      key: c,
      style: {
        padding: "3px 10px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        fontSize: 12,
        color: "var(--ink-mid)"
      }
    }, c))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12.5,
        color: "var(--ink-muted)"
      }
    }, e.meta || "No further detail on file."), e.jump && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        color: "var(--accent)",
        fontWeight: 500,
        cursor: "pointer"
      }
    }, e.jump, " \u2192"))));
  }));
}
Object.assign(__ds_scope, { Timeline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/Timeline.jsx", error: String((e && e.message) || e) }); }

// components/domain/TrustPosture.jsx
try { (() => {
/* "Seeing the automation at work is the trust mechanism." The raw rung name never appears on screen.
   An unrecognised rung falls back to the MOST MANUAL phrasing — understating automation is always safe. */
const RUNGS = ["suggest", "one_click_confirm", "auto_with_undo", "silent_auto"];
function TrustPosture({
  rung = "suggest",
  sentences,
  accuracy,
  subline,
  locked = false,
  prominence = "line",
  style
}) {
  const idx = Math.max(0, RUNGS.indexOf(rung)); // unknown → 0 (most manual)
  let sentence = locked ? "Always stays yours — by design" : sentences && sentences[idx] || sentences && sentences[0] || "You review and confirm each item";
  if (!locked && idx > 0 && accuracy) sentence += ` (${accuracy.pct}% over ${accuracy.n})`;
  const color = locked ? "var(--ink-faint)" : "var(--ink-muted)";
  const icon = "✦";
  if (prominence === "card") return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "16px 18px",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: locked ? "var(--ink-faint)" : "var(--accent)",
      flex: "none",
      marginTop: 1,
      filter: locked ? "grayscale(1)" : "none"
    }
  }, icon), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: locked ? "var(--ink-faint)" : "var(--ink)"
    }
  }, sentence), subline && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-muted)",
      lineHeight: 1.55,
      marginTop: 6
    }
  }, subline))));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 8,
      fontSize: 12.5,
      color,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      flex: "none",
      filter: locked ? "grayscale(1)" : "none",
      color: locked ? "var(--ink-faint)" : "var(--accent)",
      opacity: .8
    }
  }, icon), /*#__PURE__*/React.createElement("span", null, sentence, subline ? " · " + subline : ""));
}
Object.assign(__ds_scope, { TrustPosture });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/TrustPosture.jsx", error: String((e && e.message) || e) }); }

// components/domain/TrustSettings.jsx
try { (() => {
function TrustSettings({
  rows = [],
  onGraduate,
  onDemote,
  footnote,
  style
}) {
  if (!rows.length) return /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--ink-faint)",
      padding: "14px 0",
      ...style
    }
  }, "Nothing graduated yet.");
  const quiet = {
    background: "none",
    border: "1.5px solid var(--border-strong)",
    padding: "5px 12px",
    borderRadius: 8,
    fontFamily: "var(--font-body)",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    color: "var(--ink)"
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 2px",
      borderBottom: i < rows.length - 1 ? "1px solid var(--surface2)" : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: r.locked ? "var(--ink-faint)" : "var(--ink)"
    }
  }, r.name, r.locked && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 500,
      color: "var(--ink-faint)",
      marginLeft: 8,
      padding: "1px 7px",
      borderRadius: 999,
      background: "var(--neutral-soft)"
    }
  }, "Capped")), r.stats && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-faint)",
      fontVariantNumeric: "tabular-nums",
      marginTop: 2
    }
  }, r.stats)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      flex: "none"
    }
  }, [0, 1, 2, 3].map(p => /*#__PURE__*/React.createElement("div", {
    key: p,
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: r.locked ? "var(--border)" : p === r.rung ? "var(--accent)" : "var(--border)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flex: "none",
      width: 170,
      justifyContent: "flex-end"
    }
  }, !r.locked && r.proposed && r.rung < 3 && /*#__PURE__*/React.createElement("button", {
    onClick: () => onGraduate && onGraduate(i),
    style: {
      ...quiet,
      color: "var(--accent-ink)",
      borderColor: "var(--accent-soft-hover)",
      background: "var(--accent-soft)",
      border: "none",
      padding: "6.5px 12px"
    }
  }, "Graduate"), !r.locked && r.rung > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => onDemote && onDemote(i),
    style: quiet
  }, "Demote"))))), footnote && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-faint)",
      marginTop: 10,
      lineHeight: 1.5
    }
  }, footnote));
}
Object.assign(__ds_scope, { TrustSettings });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/domain/TrustSettings.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  checked = false,
  onChange,
  label,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: () => onChange && onChange(!checked),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 6,
      border: "1.5px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
      background: checked ? "var(--accent)" : "var(--surface)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontSize: 12,
      transition: "all .25s var(--ease-spring)",
      boxSizing: "border-box",
      flex: "none"
    }
  }, checked ? "✓" : ""), label && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5
    }
  }, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function Field({
  label,
  htmlFor,
  meta,
  helper,
  error,
  locked = false,
  style,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 7,
      ...style
    }
  }, /*#__PURE__*/React.createElement("label", {
    htmlFor: htmlFor,
    style: {
      fontSize: 13.5,
      fontWeight: 500,
      color: locked ? "var(--ink-faint)" : "var(--ink)"
    }
  }, label, meta && /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 400,
      color: "var(--ink-faint)"
    }
  }, " ", meta)), children, error ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12.5,
      color: "var(--warn-ink)",
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11
    }
  }, "\u25B2"), error) : helper ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-faint)"
    }
  }, helper) : null);
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  invalid = false,
  disabled = false,
  style,
  ...rest
}) {
  const [f, setF] = React.useState(false);
  if (disabled) return /*#__PURE__*/React.createElement("input", _extends({
    disabled: true,
    style: {
      fontFamily: "var(--font-body)",
      fontSize: 15,
      padding: "11px 16px",
      borderRadius: 10,
      border: "1.5px solid var(--border)",
      background: "var(--surface2)",
      color: "var(--ink-faint)",
      outline: "none",
      cursor: "not-allowed",
      ...style
    }
  }, rest));
  const border = invalid ? "var(--warn-dot)" : f ? "var(--accent)" : "var(--border-strong)";
  const glow = invalid ? "0 0 0 4px rgba(217,166,74,.18)" : "0 0 0 4px rgba(47,168,118,.15)";
  return /*#__PURE__*/React.createElement("input", _extends({
    onFocus: e => {
      setF(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setF(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      fontFamily: "var(--font-body)",
      fontSize: 15,
      padding: "11px 16px",
      borderRadius: 10,
      border: "1.5px solid " + border,
      background: "var(--surface)",
      color: "var(--ink)",
      outline: "none",
      transition: "border-color .2s,box-shadow .2s",
      boxShadow: f ? glow : "none",
      boxSizing: "border-box",
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
function Radio({
  checked = false,
  onChange,
  label,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: () => onChange && onChange(true),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 20,
      height: 20,
      boxSizing: "border-box",
      borderRadius: "50%",
      border: "2px solid " + (checked ? "var(--accent)" : "var(--border-strong)"),
      display: "grid",
      placeItems: "center",
      transition: "border-color .2s",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: "var(--accent)",
      transform: checked ? "scale(1)" : "scale(0)",
      transition: "transform .3s var(--ease-spring)"
    }
  })), label && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14.5
    }
  }, label));
}
function RadioGroup({
  options = [],
  value,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      ...style
    }
  }, options.map(o => /*#__PURE__*/React.createElement(Radio, {
    key: o,
    checked: o === value,
    onChange: () => onChange && onChange(o),
    label: o
  })));
}
Object.assign(__ds_scope, { Radio, RadioGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function Select({
  options = [],
  value,
  onChange,
  placeholder = "Choose…",
  style
}) {
  const [open, setOpen] = React.useState(false),
    [h, setH] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const cb = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", cb);
    return () => document.removeEventListener("mousedown", cb);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => setOpen(o => !o),
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "11px 16px",
      borderRadius: 10,
      border: "1.5px solid " + (open || h ? "var(--accent)" : "var(--border-strong)"),
      background: "var(--surface)",
      cursor: "pointer",
      fontSize: 15,
      fontWeight: 500,
      transition: "border-color .2s"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: value ? "var(--ink)" : "var(--ink-faint)"
    }
  }, value || placeholder), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--ink-faint)",
      transform: open ? "rotate(180deg)" : "none",
      transition: "transform .3s var(--ease-enter)",
      display: "inline-block"
    }
  }, "\u25BC")), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: "calc(100% + 6px)",
      left: 0,
      right: 0,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      boxShadow: "var(--shadow-overlay)",
      padding: 6,
      zIndex: 20,
      animation: "vv-pop .3s var(--ease-enter) both"
    }
  }, options.map(o => /*#__PURE__*/React.createElement("div", {
    key: o,
    onClick: () => {
      onChange && onChange(o);
      setOpen(false);
    },
    onMouseEnter: e => e.currentTarget.style.background = "var(--surface2)",
    onMouseLeave: e => e.currentTarget.style.background = o === value ? "var(--accent-soft)" : "transparent",
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "9px 12px",
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 500,
      cursor: "pointer",
      color: o === value ? "var(--accent-ink)" : "var(--ink)",
      background: o === value ? "var(--accent-soft)" : "transparent",
      transition: "background .15s"
    }
  }, /*#__PURE__*/React.createElement("span", null, o), o === value && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--accent)"
    }
  }, "\u2713")))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Slider.jsx
try { (() => {
function Slider({
  label,
  value = 50,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  unit = "%",
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 13,
      color: "var(--ink-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: "var(--ink)",
      fontVariantNumeric: "tabular-nums"
    }
  }, value, unit)), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: e => onChange && onChange(+e.target.value),
    style: {
      width: "100%",
      accentColor: "var(--accent)",
      cursor: "pointer"
    }
  }));
}
Object.assign(__ds_scope, { Slider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Slider.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function Switch({
  checked = false,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    onMouseDown: () => onChange && onChange(!checked),
    role: "switch",
    "aria-checked": checked,
    tabIndex: 0,
    style: {
      width: 52,
      height: 30,
      borderRadius: 999,
      background: checked ? "var(--accent)" : "var(--border-strong)",
      cursor: "pointer",
      position: "relative",
      flex: "none",
      transition: "background .35s",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 3,
      left: checked ? 25 : 3,
      width: 24,
      height: 24,
      borderRadius: "50%",
      background: "#fff",
      transition: "left .55s cubic-bezier(.34,1.6,.42,1)",
      boxShadow: "0 1px 3px rgba(23,24,29,.2)"
    }
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextArea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function TextArea({
  max,
  counter = false,
  style,
  ...rest
}) {
  const [f, setF] = React.useState(false),
    [n, setN] = React.useState((rest.value || rest.defaultValue || "").length);
  const near = max && n > max * 0.9;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("textarea", _extends({
    rows: rest.rows || 4,
    onFocus: e => {
      setF(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setF(false);
      rest.onBlur && rest.onBlur(e);
    },
    onInput: e => {
      setN(e.target.value.length);
      rest.onInput && rest.onInput(e);
    },
    style: {
      fontFamily: "var(--font-body)",
      fontSize: 15,
      lineHeight: 1.55,
      padding: "12px 16px",
      borderRadius: 10,
      border: "1.5px solid " + (f ? "var(--accent)" : "var(--border-strong)"),
      background: "var(--surface)",
      color: "var(--ink)",
      outline: "none",
      resize: "vertical",
      minHeight: 88,
      transition: "border-color .2s,box-shadow .2s",
      boxShadow: f ? "0 0 0 4px rgba(47,168,118,.15)" : "none",
      boxSizing: "border-box",
      ...style
    }
  }, rest)), counter && max && /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: "flex-end",
      fontSize: 12.5,
      fontVariantNumeric: "tabular-nums",
      fontWeight: near ? 700 : 400,
      color: near ? "var(--warn-ink)" : "var(--ink-faint)",
      transition: "color .3s"
    }
  }, n, "/", max));
}
Object.assign(__ds_scope, { TextArea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextArea.jsx", error: String((e && e.message) || e) }); }

// components/messaging/Composer.jsx
try { (() => {
function Composer({
  placeholder = "Message the crew — @ to mention",
  onSend,
  style
}) {
  const [draft, setDraft] = React.useState(""),
    [f, setF] = React.useState(false);
  const canSend = draft.trim().length > 0;
  const send = () => {
    if (canSend) {
      onSend && onSend(draft.trim());
      setDraft("");
    }
  };
  const tb = {
    width: 26,
    height: 24,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12.5,
    color: "var(--ink-muted)",
    cursor: "pointer"
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid var(--border)",
      padding: "12px 14px",
      background: "var(--surface)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      border: "1.5px solid " + (f ? "var(--accent)" : "var(--border-strong)"),
      borderRadius: 12,
      background: "var(--surface)",
      transition: "border-color .2s,box-shadow .2s",
      boxShadow: f ? "0 0 0 4px rgba(47,168,118,.15)" : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 2,
      padding: "7px 10px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: "Bold",
    style: {
      ...tb,
      fontWeight: 700
    }
  }, "B"), /*#__PURE__*/React.createElement("div", {
    title: "Italic",
    style: {
      ...tb,
      fontStyle: "italic",
      fontFamily: "var(--font-display)"
    }
  }, "I"), /*#__PURE__*/React.createElement("div", {
    title: "List",
    style: {
      ...tb,
      fontSize: 13
    }
  }, "\u2254"), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 16,
      background: "var(--border)",
      margin: "4px 6px"
    }
  }), /*#__PURE__*/React.createElement("div", {
    title: "Attach",
    style: {
      ...tb,
      width: "auto",
      padding: "0 8px",
      fontSize: 12,
      fontWeight: 500
    }
  }, "+ Attach")), /*#__PURE__*/React.createElement("textarea", {
    rows: 1,
    placeholder: placeholder,
    value: draft,
    onChange: e => setDraft(e.target.value),
    onFocus: () => setF(true),
    onBlur: () => setF(false),
    onKeyDown: e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    style: {
      display: "block",
      width: "100%",
      boxSizing: "border-box",
      fontFamily: "var(--font-body)",
      fontSize: 14,
      lineHeight: 1.5,
      padding: "8px 12px 10px",
      border: "none",
      background: "none",
      color: "var(--ink)",
      outline: "none",
      resize: "none",
      minHeight: 38,
      maxHeight: 120
    }
  })), /*#__PURE__*/React.createElement("button", {
    onClick: send,
    style: {
      background: canSend ? "var(--accent)" : "var(--surface2)",
      color: canSend ? "#fff" : "var(--ink-faint)",
      border: "none",
      padding: "11px 18px",
      borderRadius: 10,
      fontFamily: "var(--font-body)",
      fontWeight: 500,
      fontSize: 14,
      cursor: canSend ? "pointer" : "default",
      flex: "none",
      transition: "background .2s"
    }
  }, "Send")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-faint)",
      marginTop: 7,
      paddingLeft: 2
    }
  }, "Enter sends \xB7 Shift+Enter for a new line \xB7 @ mentions"));
}
Object.assign(__ds_scope, { Composer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/messaging/Composer.jsx", error: String((e && e.message) || e) }); }

// components/messaging/Thread.jsx
try { (() => {
function Thread({
  messages = [],
  divider,
  height = 330,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      overflowY: "auto",
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      background: "var(--canvas)",
      ...style
    }
  }, divider && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      margin: "6px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--border)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      letterSpacing: ".1em",
      textTransform: "uppercase",
      color: "var(--ink-faint)"
    }
  }, divider), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--border)"
    }
  })), messages.map((m, i) => {
    const prev = messages[i - 1];
    const grouped = prev && prev.author === m.author; // same author within 5 min → group
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        gap: 11,
        padding: "5px 0",
        marginTop: grouped ? 0 : i ? 10 : 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 32,
        flex: "none"
      }
    }, !grouped && /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
      initials: m.initials,
      hue: m.hue ?? 0,
      size: 32
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, !grouped && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        marginBottom: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13.5,
        fontWeight: 700
      }
    }, m.author), m.role && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 500,
        padding: "1px 7px",
        borderRadius: 999,
        background: "var(--surface2)",
        color: "var(--ink-muted)"
      }
    }, m.role), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11.5,
        color: "var(--ink-faint)"
      }
    }, m.time)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        lineHeight: 1.55,
        color: "var(--ink-mid)",
        overflowWrap: "break-word"
      }
    }, (m.text || "").split(/(@[A-Z][\w.]* ?[A-Z]?[\w.]*)/).map((part, j) => part.startsWith("@") ? /*#__PURE__*/React.createElement("span", {
      key: j,
      style: {
        background: "var(--accent-soft)",
        color: "var(--accent-ink)",
        borderRadius: 5,
        padding: "1px 4px",
        fontWeight: 500
      }
    }, part) : /*#__PURE__*/React.createElement("span", {
      key: j
    }, part))), m.file && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        marginTop: 6,
        padding: "8px 12px",
        borderRadius: 9,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 28,
        height: 28,
        borderRadius: 7,
        background: "var(--accent-soft)",
        color: "var(--accent-ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700
      }
    }, m.fileExt || "PDF"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12.5,
        fontWeight: 500
      }
    }, m.file), m.fileSize && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--ink-faint)"
      }
    }, m.fileSize))), m.replies && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 6,
        fontSize: 12.5,
        color: "var(--accent)",
        fontWeight: 500,
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13
      }
    }, "\u21B3"), m.replies)));
  }));
}
Object.assign(__ds_scope, { Thread });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/messaging/Thread.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Pagination.jsx
try { (() => {
function PgBtn({
  children,
  active,
  onClick,
  arrow
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      width: 34,
      height: 34,
      borderRadius: 9,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: arrow ? 12 : 14,
      fontWeight: 500,
      cursor: "pointer",
      boxSizing: "border-box",
      ...(arrow ? {
        border: "1.5px solid " + (h ? "var(--accent)" : "var(--border-strong)"),
        color: "var(--ink-muted)",
        transition: "border-color .2s"
      } : {
        background: active ? "var(--accent)" : h ? "var(--surface2)" : "transparent",
        color: active ? "#fff" : "var(--ink)",
        transition: "all .25s var(--ease-enter)"
      })
    }
  }, children);
}
function Pagination({
  page = 1,
  pages = 5,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(PgBtn, {
    arrow: true,
    onClick: () => onChange && onChange(Math.max(1, page - 1))
  }, "\u25C0"), Array.from({
    length: pages
  }, (_, i) => i + 1).map(p => /*#__PURE__*/React.createElement(PgBtn, {
    key: p,
    active: p === page,
    onClick: () => onChange && onChange(p)
  }, p)), /*#__PURE__*/React.createElement(PgBtn, {
    arrow: true,
    onClick: () => onChange && onChange(Math.min(pages, page + 1))
  }, "\u25B6"));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Stepper.jsx
try { (() => {
function Stepper({
  steps = [],
  current = 0,
  onSelect,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      ...style
    }
  }, steps.map((s, i) => {
    const done = i < current,
      cur = i === current;
    return /*#__PURE__*/React.createElement("div", {
      key: s,
      style: {
        display: "flex",
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: () => onSelect && onSelect(i),
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        cursor: onSelect ? "pointer" : "default"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 30,
        height: 30,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
        boxSizing: "border-box",
        background: done ? "var(--accent)" : "var(--surface)",
        color: done ? "#fff" : cur ? "var(--accent)" : "var(--ink-faint)",
        border: "1.5px solid " + (done || cur ? "var(--accent)" : "var(--border-strong)"),
        transition: "all .3s var(--ease-spring)"
      }
    }, done ? "✓" : i + 1), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: cur ? "var(--ink)" : "var(--ink-faint)",
        fontWeight: 500
      }
    }, s)), i < steps.length - 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        width: 52,
        height: 2,
        borderRadius: 2,
        background: i < current ? "var(--accent)" : "var(--border)",
        margin: "0 8px 20px",
        transition: "background .3s"
      }
    }));
  }));
}
Object.assign(__ds_scope, { Stepper });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Stepper.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  tabs = [],
  active = 0,
  onChange,
  style
}) {
  const refs = React.useRef([]);
  const [pill, setPill] = React.useState({
    l: 4,
    w: 62
  });
  const measure = React.useCallback(() => {
    const el = refs.current[active];
    if (el) setPill({
      l: el.offsetLeft,
      w: el.offsetWidth
    });
  }, [active]);
  React.useEffect(() => {
    measure();
    const t = setTimeout(measure, 350);
    return () => clearTimeout(t);
  }, [measure]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      background: "var(--surface2)",
      borderRadius: 11,
      padding: 4,
      position: "relative",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 4,
      bottom: 4,
      left: pill.l,
      width: pill.w,
      background: "var(--surface)",
      borderRadius: 8,
      boxShadow: "0 1px 4px rgba(23,24,29,.12)",
      transition: "left .35s var(--ease-spring),width .35s var(--ease-spring)"
    }
  }), tabs.map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: t,
    ref: el => refs.current[i] = el,
    onClick: () => onChange && onChange(i),
    style: {
      padding: "8px 18px",
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 500,
      cursor: "pointer",
      color: i === active ? "var(--ink)" : "var(--ink-muted)",
      position: "relative",
      zIndex: 1,
      transition: "color .3s"
    }
  }, t)));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Banner.jsx
try { (() => {
const marks = {
  neutral: "·",
  info: "i",
  positive: "✓",
  warn: "▲",
  danger: "✕"
};
function Banner({
  tone = "info",
  children,
  onClose,
  style
}) {
  const t = tone === "positive" ? "pos" : tone;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      background: `var(--${t}-soft)`,
      color: `var(--${t}-ink)`,
      borderRadius: 10,
      padding: "11px 14px",
      fontSize: 13.5,
      lineHeight: 1.55,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      marginTop: 2,
      flex: "none"
    }
  }, marks[tone]), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, children), onClose && /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      fontSize: 11,
      cursor: "pointer",
      padding: 2,
      opacity: .7
    }
  }, "\u2715"));
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Banner.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Menu.jsx
try { (() => {
function Menu({
  label = "All projects",
  items = [],
  onSelect,
  width = 200,
  style
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const cb = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", cb);
    return () => document.removeEventListener("mousedown", cb);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: "relative",
      width,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => setOpen(o => !o),
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "11px 16px",
      borderRadius: 10,
      border: "1.5px solid " + (open ? "var(--accent)" : "var(--border-strong)"),
      background: "var(--surface)",
      cursor: "pointer",
      fontSize: 15,
      fontWeight: 500,
      transition: "border-color .2s"
    }
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--ink-faint)",
      transform: open ? "rotate(180deg)" : "none",
      transition: "transform .3s var(--ease-enter)",
      display: "inline-block"
    }
  }, "\u25BC")), open && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: "calc(100% + 6px)",
      left: 0,
      right: 0,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      boxShadow: "var(--shadow-overlay)",
      padding: 6,
      zIndex: 20,
      animation: "vv-pop .3s var(--ease-enter) both"
    }
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it,
    onClick: () => {
      onSelect && onSelect(it);
      setOpen(false);
    },
    onMouseEnter: e => e.currentTarget.style.background = "var(--surface2)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent",
    style: {
      padding: "9px 12px",
      borderRadius: 8,
      fontSize: 14,
      fontWeight: 500,
      cursor: "pointer",
      transition: "background .15s"
    }
  }, it))));
}
Object.assign(__ds_scope, { Menu });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Menu.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Modal.jsx
try { (() => {
function Modal({
  open,
  onClose,
  title,
  titleAccent,
  footer,
  width = 440,
  style,
  children
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(16,17,22,.45)",
      backdropFilter: "blur(6px)",
      zIndex: 100,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      animation: "vv-fade .25s ease both"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: "100%",
      maxWidth: width,
      background: "var(--surface)",
      borderRadius: 16,
      boxShadow: "var(--shadow-modal)",
      padding: "30px 32px",
      animation: "vv-pop .45s var(--ease-enter) both",
      boxSizing: "border-box",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 16,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 28,
      lineHeight: 1.1
    }
  }, title, titleAccent && /*#__PURE__*/React.createElement("span", {
    style: {
      fontStyle: "italic",
      color: "var(--accent)"
    }
  }, " ", titleAccent)), /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      width: 32,
      height: 32,
      borderRadius: "50%",
      background: "var(--surface2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      fontSize: 16,
      color: "var(--ink-muted)",
      flex: "none"
    }
  }, "\u2715")), children, footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      justifyContent: "flex-end",
      marginTop: 26
    }
  }, footer)));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Modal.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Sheet.jsx
try { (() => {
function Sheet({
  open,
  onClose,
  title,
  titleAccent,
  footer,
  width = 296,
  absolute = false,
  children
}) {
  const pos = absolute ? "absolute" : "fixed";
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: pos,
      inset: 0,
      background: "rgba(16,17,22,.28)",
      opacity: open ? 1 : 0,
      pointerEvents: open ? "auto" : "none",
      transition: "opacity .4s",
      zIndex: 5
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: pos,
      top: 0,
      bottom: 0,
      right: 0,
      width,
      background: "var(--surface)",
      borderLeft: "1px solid var(--border)",
      boxShadow: "-16px 0 44px rgba(32,26,20,.12)",
      zIndex: 6,
      transform: open ? "translateX(0)" : "translateX(110%)",
      transition: "transform .5s var(--ease-enter)",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px 20px",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 20
    }
  }, title, titleAccent && /*#__PURE__*/React.createElement("span", {
    style: {
      fontStyle: "italic",
      color: "var(--accent)"
    }
  }, " ", titleAccent)), /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      width: 32,
      height: 32,
      borderRadius: "50%",
      background: "var(--surface2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      fontSize: 16,
      color: "var(--ink-muted)"
    }
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: "18px 20px",
      overflowY: "auto"
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      justifyContent: "flex-end",
      padding: "14px 20px",
      borderTop: "1px solid var(--border)"
    }
  }, footer)));
}
Object.assign(__ds_scope, { Sheet });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Sheet.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Toast({
  tone = "positive",
  title,
  message,
  leaving = false,
  onDismiss,
  style
}) {
  const t = tone === "positive" ? "pos" : tone;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "13px 16px",
      boxShadow: "0 16px 44px rgba(23,24,29,.18)",
      minWidth: 260,
      maxWidth: 340,
      animation: leaving ? "vv-toast-out .55s ease both" : "vv-pop .35s var(--ease-enter) both",
      boxSizing: "border-box",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: tone === "positive" ? "var(--success-dot)" : `var(--${t}-dot)`,
      marginTop: 5,
      flex: "none",
      animation: "vv-pulse 2s infinite"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 14
    }
  }, title), message && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--ink-muted)",
      lineHeight: 1.5,
      marginTop: 2
    }
  }, message)), onDismiss && /*#__PURE__*/React.createElement("div", {
    onClick: onDismiss,
    style: {
      fontSize: 12,
      color: "var(--ink-faint)",
      cursor: "pointer",
      padding: 2
    }
  }, "\u2715"));
}
function ToastStack({
  toasts = [],
  onDismiss
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 120,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      alignItems: "flex-end"
    }
  }, toasts.map(t => /*#__PURE__*/React.createElement(Toast, _extends({
    key: t.id
  }, t, {
    onDismiss: () => onDismiss && onDismiss(t.id)
  }))));
}
Object.assign(__ds_scope, { Toast, ToastStack });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Toast.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Tooltip.jsx
try { (() => {
function Tooltip({
  text,
  children,
  style
}) {
  const [on, setOn] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setOn(true),
    onMouseLeave: () => setOn(false),
    style: {
      position: "relative",
      display: "inline-block",
      ...style
    }
  }, children, on && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: "calc(100% + 8px)",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#101116",
      color: "#f0f0f4",
      fontSize: 13,
      padding: "7px 12px",
      borderRadius: 8,
      whiteSpace: "nowrap",
      animation: "vv-pop .25s var(--ease-enter) both",
      zIndex: 20
    }
  }, text));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Tooltip.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/screens.jsx
try { (() => {
const NSs = window.VerveDesignSystem_845c78;
const {
  Card,
  Badge,
  DataTable,
  DryingGauge,
  DryingTrend,
  StatusFlow,
  Timeline,
  TrustPosture,
  TrustSettings,
  Thread,
  Composer,
  EmptyState
} = NSs;
const JOBS = [{
  id: 0,
  name: "Harding St water loss",
  claim: "CLM-2026-448291",
  loss: "Water",
  dried: 47,
  tasks: 12,
  updated: "Today",
  status: "Drying",
  tone: "info",
  trend: {
    values: [82, 74, 68, 55, 47, 40, 34],
    goal: 15,
    projection: 12,
    fl: "Day 1 · 82%",
    fr: "Now · 34%"
  },
  rooms: [{
    label: "Kitchen",
    value: 0
  }, {
    label: "Hall",
    value: 47
  }, {
    label: "Crawlspace",
    value: null
  }],
  stages: [{
    label: "Contact",
    abbr: "Contact",
    date: "Apr 10",
    state: "done",
    provenance: "From the XactAnalysis assignment · Apr 10"
  }, {
    label: "Inspection",
    abbr: "Inspect",
    date: "Apr 12",
    state: "done",
    provenance: "From the inspection report · Apr 12"
  }, {
    label: "Mitigation",
    abbr: "Mitigate",
    date: "Apr 14",
    state: "current",
    provenance: "Crew dispatched · Apr 14"
  }, {
    label: "Drying",
    abbr: "Drying",
    state: "future"
  }, {
    label: "Review",
    abbr: "Review",
    date: "Apr 21",
    state: "evidence",
    provenance: "From the carrier review file · Apr 21"
  }, {
    label: "Completed",
    abbr: "Complete",
    state: "future"
  }]
}, {
  id: 1,
  name: "Oak Ave kitchen fire",
  claim: "CLM-2026-450112",
  loss: "Fire",
  dried: null,
  tasks: 4,
  updated: "Yesterday",
  status: "Review",
  tone: "warn",
  trend: {
    values: [],
    goal: null,
    projection: null
  },
  rooms: [{
    label: "Kitchen",
    value: null
  }, {
    label: "Dining",
    value: null
  }],
  stages: [{
    label: "Contact",
    abbr: "Contact",
    date: "May 2",
    state: "done",
    provenance: "From the XactAnalysis assignment · May 2"
  }, {
    label: "Inspection",
    abbr: "Inspect",
    date: "May 4",
    state: "done",
    provenance: "From the inspection report · May 4"
  }, {
    label: "Mitigation",
    abbr: "Mitigate",
    date: "May 6",
    state: "done",
    provenance: "From the work log · May 6"
  }, {
    label: "Drying",
    abbr: "Drying",
    date: "May 12",
    state: "done",
    provenance: "From the equipment log · May 12"
  }, {
    label: "Review",
    abbr: "Review",
    date: "May 15",
    state: "current",
    provenance: "Returned by the carrier · May 15"
  }, {
    label: "Completed",
    abbr: "Complete",
    state: "future"
  }]
}, {
  id: 2,
  name: "Mill Rd crawlspace",
  claim: "CLM-2026-441870",
  loss: "Mold",
  dried: 88,
  tasks: 9,
  updated: "Aug 24",
  status: "Completed",
  tone: "positive",
  trend: {
    values: [61, 52, 47, 38, 30, 22, 15, 12],
    goal: 12,
    projection: null,
    fl: "Day 1 · 61%",
    fr: "Now · 12%"
  },
  rooms: [{
    label: "Crawlspace",
    value: 88
  }],
  stages: [{
    label: "Contact",
    abbr: "Contact",
    date: "Jul 2",
    state: "done",
    provenance: "From the XactAnalysis assignment · Jul 2"
  }, {
    label: "Inspection",
    abbr: "Inspect",
    date: "Jul 3",
    state: "done",
    provenance: "From the inspection report · Jul 3"
  }, {
    label: "Mitigation",
    abbr: "Mitigate",
    date: "Jul 5",
    state: "done",
    provenance: "From the work log · Jul 5"
  }, {
    label: "Drying",
    abbr: "Drying",
    date: "Jul 14",
    state: "done",
    provenance: "From the readings log · Jul 14"
  }, {
    label: "Review",
    abbr: "Review",
    date: "Jul 20",
    state: "done",
    provenance: "From the carrier review file · Jul 20"
  }, {
    label: "Completed",
    abbr: "Complete",
    date: "Jul 22",
    state: "done",
    provenance: "From the corporate upload · Jul 22"
  }]
}];
const TL = [{
  tone: "warn",
  source: "Calendar",
  title: "Visit cancelled — Harding St",
  summary: "Was scheduled for Thu 9:00 AM",
  when: "8:40a",
  cancelBadge: true,
  chips: ["Jim Perez", "A. Okafor"],
  meta: "Front entrance · Ends 3:00 PM · on 3 calendars"
}, {
  tone: "neutral",
  source: "Carrier",
  title: "Adjuster note",
  summary: "Mia Kang left a note on the claim",
  when: "9:15a",
  quote: "Insured confirmed access for Thursday.\nPlease hold invoicing until review.",
  meta: "Crawford & Co · Note #14"
}, {
  tone: "positive",
  source: "Carrier",
  title: "Assignment delivered",
  summary: "Milestone from XactAnalysis",
  when: "10:02a",
  meta: "Assignment delivered · file FNOL-88231"
}, {
  tone: "info",
  source: "Photos",
  title: "Daily photo batch · 12 photos",
  summary: "Kitchen, crawlspace, exterior",
  when: "12:30p",
  thumbs: [{
    bg: "linear-gradient(135deg,#c8d8cf,#a9c4b6)"
  }, {
    bg: "linear-gradient(135deg,#d8cfc2,#c2b4a0)"
  }, {
    bg: "linear-gradient(135deg,#b8ccd4,#9db6c2)"
  }],
  meta: "12 photos · uploaded by Jim Perez"
}, {
  tone: "neutral",
  source: "Carrier",
  title: "Adjuster note",
  when: "1:12p",
  meta: "This note has no message text."
}, {
  tone: "info",
  source: "Chat",
  title: "Daily comments · 4 messages",
  summary: "Dana R., Jim Perez",
  when: "4:55p",
  quote: "“Dehumidifiers swapped in the kitchen.”\n“Hold invoicing until the review clears.”",
  meta: "Dana R. · Jim Perez",
  jump: "View in chat"
}];
const secTitle = {
  fontFamily: "var(--font-display)",
  fontSize: 24,
  marginBottom: 14
};
const panelLbl = {
  fontSize: 11.5,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  marginBottom: 10
};
function JobsScreen({
  onOpen
}) {
  const stats = [["Live jobs", "38", "+3 this week", "var(--accent-ink)"], ["Waiting on you", "6", "2 carrier returns", "var(--warn-ink)"], ["Drying on track", "81%", "of measured jobs", "var(--ink-muted)"]];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24,
      display: "flex",
      flexDirection: "column",
      gap: 20,
      animation: "vv-pagein .45s var(--ease-enter) both"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: secTitle
  }, "Good morning, ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontStyle: "italic",
      color: "var(--accent)"
    }
  }, "Dana")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 14
    }
  }, stats.map(([l, v, d, c]) => /*#__PURE__*/React.createElement(Card, {
    key: l,
    eyebrow: l
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 34,
      lineHeight: 1
    }
  }, v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: c,
      marginTop: 6,
      fontWeight: 500
    }
  }, d)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1.8,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      key: "name",
      label: "Job"
    }, {
      key: "dried",
      label: "Dried",
      sortable: false,
      render: r => /*#__PURE__*/React.createElement(DryingGauge, {
        value: r.dried,
        size: 20,
        label: ""
      })
    }, {
      key: "tasks",
      label: "Tasks",
      muted: true,
      tabular: true
    }, {
      key: "updated",
      label: "Updated",
      muted: true
    }, {
      key: "status",
      label: "Status",
      sortable: false,
      render: r => /*#__PURE__*/React.createElement(Badge, {
        tone: r.tone
      }, r.status)
    }],
    rows: JOBS,
    onRowClick: r => onOpen(r.id)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--ink-faint)",
      marginTop: 8
    }
  }, "3 of 38 jobs shown \xB7 a dash means no usable readings yet \u2014 unknown, never zero.")), /*#__PURE__*/React.createElement(Card, {
    hover: false,
    style: {
      flex: 1,
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: panelLbl
  }, "Today"), /*#__PURE__*/React.createElement(Timeline, {
    density: "dense",
    events: TL.slice(0, 4)
  }))));
}
function JobScreen({
  job,
  onNewReading
}) {
  const [msgs, setMsgs] = React.useState([{
    author: "Dana R.",
    initials: "DR",
    hue: 0,
    role: "Operator",
    time: "9:12a",
    text: "@Jim Perez can you swap the dehumidifiers in the kitchen today?"
  }, {
    author: "Jim Perez",
    initials: "JP",
    hue: 1,
    role: "Crew lead",
    time: "9:40a",
    text: "On it. Uploading the photo batch after lunch."
  }]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24,
      display: "flex",
      flexDirection: "column",
      gap: 18,
      animation: "vv-pagein .45s var(--ease-enter) both"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 12,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 24
    }
  }, job.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: "var(--ink-faint)",
      fontVariantNumeric: "tabular-nums"
    }
  }, job.claim, " \xB7 ", job.loss), /*#__PURE__*/React.createElement(Badge, {
    tone: job.tone
  }, job.status)), /*#__PURE__*/React.createElement(Card, {
    hover: false,
    style: {
      padding: "18px 20px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: panelLbl
  }, "Lifecycle"), /*#__PURE__*/React.createElement(StatusFlow, {
    stages: job.stages
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      alignItems: "stretch"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    hover: false,
    style: {
      flex: 1.1,
      padding: "16px 18px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: panelLbl
  }, "Drying"), /*#__PURE__*/React.createElement("span", {
    onClick: onNewReading,
    style: {
      fontSize: 12.5,
      color: "var(--accent)",
      fontWeight: 500,
      cursor: "pointer"
    }
  }, "New reading")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      alignItems: "flex-start",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(DryingGauge, {
    value: job.dried,
    size: 88,
    label: job.dried === null ? "No readings" : "Structure"
  }), /*#__PURE__*/React.createElement(DryingTrend, {
    values: job.trend.values,
    goal: job.trend.goal,
    projection: job.trend.projection,
    footerLeft: job.trend.fl,
    footerRight: job.trend.fr,
    width: 220,
    style: {
      flex: 1,
      minWidth: 220
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      marginTop: 12
    }
  }, job.rooms.map(r => /*#__PURE__*/React.createElement(DryingGauge, {
    key: r.label,
    value: r.value,
    size: 20,
    label: r.label
  })))), /*#__PURE__*/React.createElement(Card, {
    hover: false,
    style: {
      flex: 1,
      padding: "8px 16px",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...panelLbl,
      margin: "10px 0 2px"
    }
  }, "Timeline"), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowY: "auto",
      maxHeight: 260
    }
  }, /*#__PURE__*/React.createElement(Timeline, {
    events: TL
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      border: "1px solid var(--border)",
      borderRadius: 16,
      overflow: "hidden",
      background: "var(--surface)"
    }
  }, /*#__PURE__*/React.createElement(Thread, {
    divider: "Today",
    height: 200,
    messages: msgs
  }), /*#__PURE__*/React.createElement(Composer, {
    onSend: t => setMsgs(m => [...m, {
      author: "Dana R.",
      initials: "DR",
      hue: 0,
      time: "now",
      text: t
    }])
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(TrustPosture, {
    prominence: "card",
    rung: "auto_with_undo",
    accuracy: {
      pct: 94,
      n: 120
    },
    sentences: ["You review and confirm each line", "You confirm each line with one tap", "Drafts are prepared automatically — you can undo", "Drafts are prepared automatically"],
    subline: "These are drafts \u2014 nothing is sent automatically. Sending to the carrier stays a separate step you take."
  }), /*#__PURE__*/React.createElement(TrustPosture, {
    rung: "suggest",
    sentences: ["You review and confirm the proof packet", "You give the sign-off with one tap", "The proof is signed off automatically — you can undo", "The proof is signed off automatically"],
    subline: "Submitting to corporate stays a separate step you take."
  }))));
}
function AutomationScreen() {
  const [rows, setRows] = React.useState([{
    name: "Dispute drafts",
    rung: 2,
    stats: "94% accurate · 120 outcomes",
    proposed: true
  }, {
    name: "Proof sign-off",
    rung: 0,
    stats: "88% accurate · 41 outcomes",
    proposed: false
  }, {
    name: "Reading reminders",
    rung: 1,
    stats: "97% accurate · 210 outcomes",
    proposed: false
  }, {
    name: "Submit to corporate",
    rung: 0,
    locked: true
  }]);
  const bump = (i, d) => setRows(rs => rs.map((r, j) => j === i ? {
    ...r,
    rung: Math.max(0, Math.min(3, r.rung + d))
  } : r));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24,
      maxWidth: 720,
      animation: "vv-pagein .45s var(--ease-enter) both"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: secTitle
  }, "Automation"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-muted)",
      maxWidth: 560,
      marginBottom: 16,
      lineHeight: 1.6
    }
  }, "How much each action runs on its own. Anything that reaches outside the building irreversibly stays capped \u2014 a settled decision, not a warning."), /*#__PURE__*/React.createElement(Card, {
    hover: false,
    style: {
      padding: "6px 18px"
    }
  }, /*#__PURE__*/React.createElement(TrustSettings, {
    rows: rows,
    onGraduate: i => bump(i, 1),
    onDemote: i => bump(i, -1),
    footnote: "Actions graduate at \u226590% observed accuracy over at least 40 outcomes in the last 60 days."
  })));
}
Object.assign(window, {
  JobsScreen,
  JobScreen,
  AutomationScreen,
  VERVE_JOBS: JOBS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/shell.jsx
try { (() => {
const NS = window.VerveDesignSystem_845c78;
const {
  Avatar
} = NS;
function ConsoleSidebar({
  page,
  onNav,
  counts
}) {
  const items = [["jobs", "Jobs", counts.jobs, "var(--surface2)", "var(--ink-muted)"], ["visits", "Visits", counts.visits, "var(--warn-soft)", "var(--warn-ink)"], ["photos", "Photos", null], ["messages", "Messages", counts.messages, "var(--surface2)", "var(--ink-muted)"], ["automation", "Automation", null]];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 192,
      flex: "none",
      background: "var(--canvas)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      padding: "14px 10px",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/servpro-logo.png",
    alt: "Servpro",
    style: {
      width: 54,
      height: 54,
      objectFit: "contain",
      margin: "0 0 10px 6px"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, items.map(([id, label, count, cbg, cink]) => /*#__PURE__*/React.createElement("div", {
    key: id,
    onClick: () => onNav(id),
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "9px 12px",
      borderRadius: 9,
      fontSize: 14,
      fontWeight: 500,
      cursor: "pointer",
      color: page === id ? "var(--accent-ink)" : "var(--ink-mid)",
      background: page === id ? "var(--accent-soft)" : "transparent",
      transition: "background .2s,color .2s"
    },
    onMouseEnter: e => {
      if (page !== id) e.currentTarget.style.background = "var(--surface2)";
    },
    onMouseLeave: e => {
      if (page !== id) e.currentTarget.style.background = "transparent";
    }
  }, /*#__PURE__*/React.createElement("span", null, label), count && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 700,
      padding: "1px 7px",
      borderRadius: 999,
      background: cbg,
      color: cink,
      fontVariantNumeric: "tabular-nums"
    }
  }, count)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "8px 10px",
      borderRadius: 9,
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    initials: "DR",
    size: 28
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      lineHeight: 1.2
    }
  }, "Dana R."), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "var(--ink-faint)"
    }
  }, "Operator"))));
}
function ConsoleTopBar({
  crumbs,
  action,
  onAction,
  onTheme,
  dark
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "12px 20px",
      borderBottom: "1px solid var(--border)",
      flex: "none",
      background: "var(--surface)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-faint)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, crumbs.map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      margin: "0 4px"
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: i === crumbs.length - 1 ? "var(--ink)" : "var(--ink-faint)",
      fontWeight: i === crumbs.length - 1 ? 500 : 400,
      cursor: c.go ? "pointer" : "default"
    },
    onClick: c.go
  }, c.label)))), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search jobs\u2026",
    style: {
      fontFamily: "var(--font-body)",
      fontSize: 13.5,
      padding: "8px 14px",
      borderRadius: 9,
      border: "1.5px solid var(--border-strong)",
      background: "var(--surface)",
      color: "var(--ink)",
      outline: "none",
      width: 180,
      marginLeft: "auto"
    }
  }), /*#__PURE__*/React.createElement("div", {
    onClick: onTheme,
    style: {
      fontSize: 12.5,
      fontWeight: 500,
      color: "var(--ink-muted)",
      cursor: "pointer",
      padding: "6px 10px",
      borderRadius: 9,
      background: "var(--surface2)",
      whiteSpace: "nowrap"
    }
  }, dark ? "Light" : "Dark"), action && /*#__PURE__*/React.createElement(NS.Button, {
    size: "sm",
    onClick: onAction,
    style: {
      whiteSpace: "nowrap"
    }
  }, action));
}
Object.assign(window, {
  ConsoleSidebar,
  ConsoleTopBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/shell.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.AvatarStack = __ds_scope.AvatarStack;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.DatePicker = __ds_scope.DatePicker;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.DryingGauge = __ds_scope.DryingGauge;

__ds_ns.DryingTrend = __ds_scope.DryingTrend;

__ds_ns.StatusFlow = __ds_scope.StatusFlow;

__ds_ns.Timeline = __ds_scope.Timeline;

__ds_ns.TrustPosture = __ds_scope.TrustPosture;

__ds_ns.TrustSettings = __ds_scope.TrustSettings;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.RadioGroup = __ds_scope.RadioGroup;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Slider = __ds_scope.Slider;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.TextArea = __ds_scope.TextArea;

__ds_ns.Composer = __ds_scope.Composer;

__ds_ns.Thread = __ds_scope.Thread;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.Stepper = __ds_scope.Stepper;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Menu = __ds_scope.Menu;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Sheet = __ds_scope.Sheet;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.ToastStack = __ds_scope.ToastStack;

__ds_ns.Tooltip = __ds_scope.Tooltip;

})();
