import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Published at https://humanx123.github.io/gesto-studio/
export default defineConfig({
  plugins: [react()],
  base: '/gesto-studio/',
});
