// Ambient declarations for two Prism grammar wrappers that `@types/react-syntax-highlighter` leaves out.
//
// The package ships `dist/esm/languages/prism/jsdoc.js` and `phpdoc.js`. The types package declares `jsdoc`
// under `dist/cjs/...` only and `phpdoc` in neither build, while `src/shared/syntaxHighlighter.ts` imports
// both from `dist/esm/...`. Every other deep path that module reads is declared upstream as a lone default
// export of a grammar function, so these two declare the same thing — typed `unknown` rather than `any`,
// which is all `registerLanguage` needs to take it.
//
// A script file on purpose, with no top-level import or export: inside a module file `declare module`
// would be an augmentation of a module that resolves to untyped JavaScript, which TypeScript refuses.

declare module 'react-syntax-highlighter/dist/esm/languages/prism/jsdoc' {
  const language: unknown;
  export default language;
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/phpdoc' {
  const language: unknown;
  export default language;
}
