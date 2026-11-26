// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // Reglas del React Compiler (react-hooks 7). Con `reactCompiler: true` un aviso solo
      // significa que el compilador se salta ese componente (sigue funcionando como hoy);
      // corregirlas exige rehacer hooks en muchos archivos (refs leídos al renderizar,
      // setState en efectos…). Avisos, no errores, hasta que se aborden una a una.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/immutability': 'warn',
      // Regla pensada para HTML: en <Text> de React Native el apóstrofo se pinta tal cual
      // (lo usamos para minutos: «50'»).
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    ignores: [
      '.claude/**',
      '.expo/**',
      'dist/**',
      'web-build/**',
      'ios/**',
      'android/**',
      'node_modules/**',
      // Deno (imports por URL / npm:) y el worker de Cloudflare: tienen su propio entorno.
      'supabase/functions/**',
      'cloudflare/**',
    ],
  },
]);
