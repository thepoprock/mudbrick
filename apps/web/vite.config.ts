import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the app under /mudbrick/; the workflow sets MUDBRICK_BASE.
  base: process.env.MUDBRICK_BASE ?? '/',
  build: { target: 'es2022' },
  server: {
    // `dev-game` is a gitignored symlink to the developer's own copy of the original game.
    // Following it needs the strict file-system check off in development only.
    fs: { strict: false },
  },
});
