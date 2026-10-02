import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{proxy:{'/api':process.env.API_PROXY_TARGET||'http://localhost:4000','/insights':{target:process.env.INSIGHTS_PROXY_TARGET||'http://localhost:8000',changeOrigin:true,rewrite:path=>path.replace(/^\/insights/,'')}}}});
