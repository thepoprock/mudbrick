import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' },
  server: {
    // `dev-game` is a gitignored symlink to the developer's own copy of the original game.
    // Following it needs the strict file-system check off in development only.
    fs: { strict: false },
  },
});
