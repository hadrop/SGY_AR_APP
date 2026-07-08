import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is only needed for phone testing (camera/GPS require a secure
// context); use `npm run dev:https`. Plain `npm run dev` serves HTTP.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'https' ? [basicSsl()] : [],
}));
