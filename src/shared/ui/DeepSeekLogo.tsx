type DeepSeekLogoProps = {
  className?: string;
};

/**
 * Reached through the shared `LLMProviderLogo`, which branches to it on `provider === 'deepseek'` —
 * the only door to this mark. `SoulLaunchPinRow` draws that wrapper for a launcher soul, so a reader
 * who takes the `deepseek` branch out of `LLMProviderLogo` as apparently unused removes the mark
 * from the pin.
 *
 * THE OPERATOR'S OWN ARTWORK, traced rather than drawn by hand (2026-09-13) with the pin's 14 px as
 * the size that had to survive. One path carries everything — the outline, the open mouth and the
 * eye — the cut-outs being subpaths under `evenodd`, checked against the source by rasterising
 * both: 0.3% of the viewBox disagrees, which is nothing at 14 px. At that size the eye is under a
 * pixel across, as it is in the artwork itself when shrunk that far.
 *
 * A WHALE, IN THE VENDOR'S OWN BLUE — the one thing that tells a reader at 14px which account a
 * soul was billed to. The colour is fixed rather than a theme token, for the same reason
 * `ClaudeLogo`'s is: it is the brand's, not ours, and a mark that changed colour with the app
 * would stop meaning "DeepSeek".
 */
const DeepSeekLogo = ({ className = 'w-5 h-5' }: DeepSeekLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="DeepSeek"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path fill="#4D6BFE" fillRule="evenodd" d="M 15.93 4.46 C 15.79 4.56, 15.57 5.07, 15.48 5.49 C 15.19 6.83, 15.80 8.36, 16.89 9.08 C 17.13 9.23, 17.13 9.30, 16.97 9.81 C 16.80 10.34, 16.79 10.34, 16.38 10.15 C 15.87 9.91, 15.47 9.59, 14.41 8.55 C 13.31 7.46, 13.05 7.24, 12.53 6.88 C 12.06 6.57, 11.88 6.21, 12.00 5.83 C 12.08 5.60, 12.36 5.28, 12.56 5.20 C 12.77 5.11, 12.76 4.96, 12.54 4.87 C 12.09 4.68, 11.28 4.79, 10.11 5.20 L 9.35 5.47 8.71 5.40 C 6.13 5.15, 4.31 5.84, 2.99 7.58 C 0.49 10.87, 1.74 15.91, 5.67 18.41 C 8.20 20.02, 11.76 19.98, 14.07 18.33 L 14.53 18.00 14.90 18.12 C 15.98 18.46, 17.61 18.37, 17.94 17.95 C 18.25 17.56, 17.98 17.33, 16.63 16.82 C 16.36 16.72, 16.14 16.62, 16.13 16.58 C 16.12 16.55, 16.28 16.34, 16.48 16.10 C 17.44 15.02, 17.89 14.32, 18.28 13.32 C 18.68 12.28, 19.01 10.82, 19.01 10.07 C 19.01 9.69, 19.02 9.67, 19.12 9.65 C 20.01 9.47, 20.26 9.39, 20.76 9.05 C 21.64 8.46, 22.18 7.49, 22.29 6.30 C 22.31 5.97, 22.31 5.92, 22.21 5.80 C 22.04 5.59, 21.93 5.62, 21.55 5.98 C 21.09 6.41, 20.93 6.48, 20.25 6.52 C 19.54 6.57, 19.16 6.70, 18.72 7.06 L 18.51 7.23 18.40 6.92 C 18.25 6.50, 17.93 6.19, 17.36 5.91 C 16.76 5.61, 16.57 5.42, 16.42 4.95 C 16.27 4.45, 16.14 4.32, 15.93 4.46 M 3.44 9.93 C 3.14 9.99, 3.10 10.07, 3.11 10.50 C 3.15 11.87, 3.69 13.52, 4.52 14.77 C 5.68 16.52, 7.73 17.76, 8.61 17.25 C 8.85 17.11, 8.85 16.96, 8.61 16.51 C 8.33 15.97, 8.29 15.68, 8.47 15.52 C 8.76 15.28, 9.58 15.70, 11.21 16.95 C 11.95 17.51, 12.24 17.66, 12.79 17.76 C 13.19 17.84, 14.19 17.87, 14.18 17.80 C 14.18 17.78, 14.05 17.67, 13.90 17.56 C 13.06 16.96, 12.30 16.08, 11.11 14.35 C 9.92 12.62, 9.26 11.91, 8.17 11.18 C 6.70 10.19, 4.66 9.65, 3.44 9.93 M 12.66 10.51 C 12.51 10.57, 12.41 10.70, 12.41 10.84 C 12.41 11.01, 12.50 11.06, 12.86 11.10 C 13.41 11.17, 13.54 11.35, 13.55 12.07 C 13.55 12.67, 13.61 12.79, 14.01 13.06 C 14.43 13.34, 15.13 13.29, 15.34 12.98 C 15.57 12.62, 14.35 10.95, 13.61 10.60 C 13.36 10.48, 12.87 10.44, 12.66 10.51 M 12.61 11.59 C 12.44 11.72, 12.52 11.97, 12.73 11.99 C 13.01 12.02, 13.13 11.73, 12.91 11.57 C 12.76 11.47, 12.75 11.47, 12.61 11.59" />
  </svg>
);

export default DeepSeekLogo;
