// A lint rule (loaded by oxlint's JS-plugin bridge, see `jsPlugins` in .oxlintrc.json) that refuses a bare React `createContext`.
//
// Why: in dev, a hot update loads a module a second time, and a context made with a bare `createContext` is then two objects —
// the provider (new copy) provides one, a consumer (old copy) reads the other and finds no provider. `createStableContext` in
// src/shared/context/stableContext.ts keeps the first object across copies; its doc line has the whole story.
//
// Oxlint's own `no-restricted-imports` cannot do this alone: with `importNames: ['createContext']` it flags every
// `import * as React from 'react'` (whatever the file does with it) and misses `React.createContext` through a default import.
// This rule reads how the name is reached instead: a named import (aliased or re-exported), or a member of the React namespace.
//
// The second rule, `no-duplicate-context-key`, guards the key `createStableContext` is given: the helper keeps one object per key, so
// two calls in one module with the same key are ONE context in dev (the dev server keeps the first) and two in a production build.
const MESSAGE = 'A bare createContext keeps no identity across hot reloads (a second copy of this module makes a second context, and a '
  + "consumer on the first copy fails with 'must be used within a …Provider'). Use createStableContext(import.meta.hot, '<Name>', default) "
  + "from '@/shared/context/stableContext'.";

/** The property name a member access or destructuring key spells, or null when it is computed from something but a string. */
const spelledName = (key, computed) => {
  if (!computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
};

export default {
  meta: { name: 'stable-context' },
  rules: {
    'no-bare-create-context': {
      meta: { type: 'problem', docs: { description: 'Refuse a bare React createContext; contexts are made with createStableContext.' } },
      create(context) {
        // Local names that hold the whole 'react' module (`import * as React`, `import React`).
        const reactNamespaces = new Set();
        const isReactNamespace = (node) => node && node.type === 'Identifier' && reactNamespaces.has(node.name);
        return {
          ImportDeclaration(node) {
            if (node.source.value !== 'react') return;
            for (const specifier of node.specifiers) {
              if (specifier.type !== 'ImportSpecifier') reactNamespaces.add(specifier.local.name);
              else if (specifier.imported.name === 'createContext' || specifier.imported.value === 'createContext') context.report({ node: specifier, message: MESSAGE });
            }
          },
          ExportNamedDeclaration(node) {
            if (node.source?.value !== 'react') return;
            for (const specifier of node.specifiers) {
              if (specifier.local.name === 'createContext' || specifier.local.value === 'createContext') context.report({ node: specifier, message: MESSAGE });
            }
          },
          MemberExpression(node) {
            if (isReactNamespace(node.object) && spelledName(node.property, node.computed) === 'createContext') context.report({ node, message: MESSAGE });
          },
          // `const { createContext } = React;`
          VariableDeclarator(node) {
            if (!isReactNamespace(node.init) || node.id.type !== 'ObjectPattern') return;
            for (const property of node.id.properties) {
              if (property.type === 'Property' && spelledName(property.key, property.computed) === 'createContext') context.report({ node: property, message: MESSAGE });
            }
          },
        };
      },
    },
    'no-duplicate-context-key': {
      meta: { type: 'problem', docs: { description: 'Refuse two createStableContext calls in one module that share a key.' } },
      create(context) {
        const keysSeen = new Set();
        return {
          CallExpression(node) {
            if (node.callee.type !== 'Identifier' || node.callee.name !== 'createStableContext') return;
            const key = node.arguments[1];
            // A key that is not a plain string literal cannot be compared here; the helper's doc asks for the context's name.
            if (!key || key.type !== 'Literal' || typeof key.value !== 'string') return;
            if (keysSeen.has(key.value)) {
              context.report({
                node: key,
                message: `Another createStableContext call in this module already uses the key '${key.value}'. In dev the two are ONE context `
                  + 'object (the first is kept), in a production build two. Give each context its own key — its name.',
              });
            }
            keysSeen.add(key.value);
          },
        };
      },
    },
  },
};
