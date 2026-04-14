// vitest.config.js
import { defineConfig } from "file:///Users/psd/Documents/Documents%20-%20Alpeia/PROJECTS/SOf/sof-beta/node_modules/.pnpm/vitest@1.6.1_@types+node@25.5.0_@vitest+ui@1.6.1_jsdom@26.1.0_bufferutil@4.1.0_utf-8-validate@6.0.6_/node_modules/vitest/dist/config.js";
import react from "file:///Users/psd/Documents/Documents%20-%20Alpeia/PROJECTS/SOf/sof-beta/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.1_@types+node@25.5.0_jiti@1.21.7_/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
var __vite_injected_original_import_meta_url = "file:///Users/psd/Documents/Documents%20-%20Alpeia/PROJECTS/SOf/sof-beta/packages/frontend/vitest.config.js";
var __filename = fileURLToPath(__vite_injected_original_import_meta_url);
var __dirname = dirname(__filename);
var vitest_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@lib": path.resolve(__dirname, "./src/lib"),
      "@services": path.resolve(__dirname, "./src/services"),
      "@store": path.resolve(__dirname, "./src/store"),
      "@styles": path.resolve(__dirname, "./src/styles"),
      "@types": path.resolve(__dirname, "./src/types"),
      "@utils": path.resolve(__dirname, "./src/utils"),
      "@contracts": path.resolve(__dirname, "./src/contracts")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    globals: true,
    include: [
      "tests/**/*.test.{js,jsx,ts,tsx}",
      "src/**/*.{test,spec}.{js,jsx,ts,tsx}"
    ],
    exclude: [
      "node_modules/**",
      "dist/**",
      "contracts/**",
      "contracts/**/*",
      "contracts/lib/**",
      "tests/backend/**",
      "tests/api/**",
      "tests/hooks/useRaffleTracker.test.jsx",
      "tests/components/mobile/BuySellSheet.inputAndSeasonGuard.test.jsx",
      // OOM: heavy web3 dep tree
      "src/components/delegation/DelegationModal.test.jsx",
      // ERR_REQUIRE_ESM: wagmi ESM in forks pool
      "tests/e2e/**"
      // E2E tests use Playwright, not Vitest
    ],
    deps: {
      inline: ["wagmi", "@wagmi/core"]
    },
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=4096"]
      }
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"]
    }
  }
});
export {
  vitest_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZXN0LmNvbmZpZy5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi9Vc2Vycy9wc2QvRG9jdW1lbnRzL0RvY3VtZW50cyAtIEFscGVpYS9QUk9KRUNUUy9TT2Yvc29mLWJldGEvcGFja2FnZXMvZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9wc2QvRG9jdW1lbnRzL0RvY3VtZW50cyAtIEFscGVpYS9QUk9KRUNUUy9TT2Yvc29mLWJldGEvcGFja2FnZXMvZnJvbnRlbmQvdml0ZXN0LmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvcHNkL0RvY3VtZW50cy9Eb2N1bWVudHMlMjAtJTIwQWxwZWlhL1BST0pFQ1RTL1NPZi9zb2YtYmV0YS9wYWNrYWdlcy9mcm9udGVuZC92aXRlc3QuY29uZmlnLmpzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVzdC9jb25maWdcIjtcbmltcG9ydCByZWFjdCBmcm9tIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcInVybFwiO1xuaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5cbmNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2Rpcm5hbWUgPSBkaXJuYW1lKF9fZmlsZW5hbWUpO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgICBcIkBjb21wb25lbnRzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvY29tcG9uZW50c1wiKSxcbiAgICAgIFwiQGZlYXR1cmVzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvZmVhdHVyZXNcIiksXG4gICAgICBcIkBob29rc1wiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL2hvb2tzXCIpLFxuICAgICAgXCJAbGliXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvbGliXCIpLFxuICAgICAgXCJAc2VydmljZXNcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy9zZXJ2aWNlc1wiKSxcbiAgICAgIFwiQHN0b3JlXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvc3RvcmVcIiksXG4gICAgICBcIkBzdHlsZXNcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy9zdHlsZXNcIiksXG4gICAgICBcIkB0eXBlc1wiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL3R5cGVzXCIpLFxuICAgICAgXCJAdXRpbHNcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy91dGlsc1wiKSxcbiAgICAgIFwiQGNvbnRyYWN0c1wiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL2NvbnRyYWN0c1wiKSxcbiAgICB9LFxuICB9LFxuICB0ZXN0OiB7XG4gICAgZW52aXJvbm1lbnQ6IFwianNkb21cIixcbiAgICBzZXR1cEZpbGVzOiBbXCIuL3Rlc3RzL3NldHVwLmpzXCJdLFxuICAgIGdsb2JhbHM6IHRydWUsXG4gICAgaW5jbHVkZTogW1xuICAgICAgXCJ0ZXN0cy8qKi8qLnRlc3Que2pzLGpzeCx0cyx0c3h9XCIsXG4gICAgICBcInNyYy8qKi8qLnt0ZXN0LHNwZWN9Lntqcyxqc3gsdHMsdHN4fVwiLFxuICAgIF0sXG4gICAgZXhjbHVkZTogW1xuICAgICAgXCJub2RlX21vZHVsZXMvKipcIixcbiAgICAgIFwiZGlzdC8qKlwiLFxuICAgICAgXCJjb250cmFjdHMvKipcIixcbiAgICAgIFwiY29udHJhY3RzLyoqLypcIixcbiAgICAgIFwiY29udHJhY3RzL2xpYi8qKlwiLFxuICAgICAgXCJ0ZXN0cy9iYWNrZW5kLyoqXCIsXG4gICAgICBcInRlc3RzL2FwaS8qKlwiLFxuICAgICAgXCJ0ZXN0cy9ob29rcy91c2VSYWZmbGVUcmFja2VyLnRlc3QuanN4XCIsXG4gICAgICBcInRlc3RzL2NvbXBvbmVudHMvbW9iaWxlL0J1eVNlbGxTaGVldC5pbnB1dEFuZFNlYXNvbkd1YXJkLnRlc3QuanN4XCIsIC8vIE9PTTogaGVhdnkgd2ViMyBkZXAgdHJlZVxuICAgICAgXCJzcmMvY29tcG9uZW50cy9kZWxlZ2F0aW9uL0RlbGVnYXRpb25Nb2RhbC50ZXN0LmpzeFwiLCAvLyBFUlJfUkVRVUlSRV9FU006IHdhZ21pIEVTTSBpbiBmb3JrcyBwb29sXG4gICAgICBcInRlc3RzL2UyZS8qKlwiLCAvLyBFMkUgdGVzdHMgdXNlIFBsYXl3cmlnaHQsIG5vdCBWaXRlc3RcbiAgICBdLFxuICAgIGRlcHM6IHtcbiAgICAgIGlubGluZTogW1wid2FnbWlcIiwgXCJAd2FnbWkvY29yZVwiXSxcbiAgICB9LFxuICAgIHBvb2xPcHRpb25zOiB7XG4gICAgICBmb3Jrczoge1xuICAgICAgICBleGVjQXJndjogW1wiLS1tYXgtb2xkLXNwYWNlLXNpemU9NDA5NlwiXSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBjb3ZlcmFnZToge1xuICAgICAgcHJvdmlkZXI6IFwidjhcIixcbiAgICAgIHJlcG9ydGVyOiBbXCJ0ZXh0XCIsIFwianNvblwiLCBcImh0bWxcIl0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF1YSxTQUFTLG9CQUFvQjtBQUNwYyxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMscUJBQXFCO0FBQzlCLFNBQVMsZUFBZTtBQUpnUCxJQUFNLDJDQUEyQztBQU16VCxJQUFNLGFBQWEsY0FBYyx3Q0FBZTtBQUNoRCxJQUFNLFlBQVksUUFBUSxVQUFVO0FBRXBDLElBQU8sd0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxXQUFXLE9BQU87QUFBQSxNQUNwQyxlQUFlLEtBQUssUUFBUSxXQUFXLGtCQUFrQjtBQUFBLE1BQ3pELGFBQWEsS0FBSyxRQUFRLFdBQVcsZ0JBQWdCO0FBQUEsTUFDckQsVUFBVSxLQUFLLFFBQVEsV0FBVyxhQUFhO0FBQUEsTUFDL0MsUUFBUSxLQUFLLFFBQVEsV0FBVyxXQUFXO0FBQUEsTUFDM0MsYUFBYSxLQUFLLFFBQVEsV0FBVyxnQkFBZ0I7QUFBQSxNQUNyRCxVQUFVLEtBQUssUUFBUSxXQUFXLGFBQWE7QUFBQSxNQUMvQyxXQUFXLEtBQUssUUFBUSxXQUFXLGNBQWM7QUFBQSxNQUNqRCxVQUFVLEtBQUssUUFBUSxXQUFXLGFBQWE7QUFBQSxNQUMvQyxVQUFVLEtBQUssUUFBUSxXQUFXLGFBQWE7QUFBQSxNQUMvQyxjQUFjLEtBQUssUUFBUSxXQUFXLGlCQUFpQjtBQUFBLElBQ3pEO0FBQUEsRUFDRjtBQUFBLEVBQ0EsTUFBTTtBQUFBLElBQ0osYUFBYTtBQUFBLElBQ2IsWUFBWSxDQUFDLGtCQUFrQjtBQUFBLElBQy9CLFNBQVM7QUFBQSxJQUNULFNBQVM7QUFBQSxNQUNQO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNQO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQTtBQUFBLE1BQ0E7QUFBQTtBQUFBLE1BQ0E7QUFBQTtBQUFBLElBQ0Y7QUFBQSxJQUNBLE1BQU07QUFBQSxNQUNKLFFBQVEsQ0FBQyxTQUFTLGFBQWE7QUFBQSxJQUNqQztBQUFBLElBQ0EsYUFBYTtBQUFBLE1BQ1gsT0FBTztBQUFBLFFBQ0wsVUFBVSxDQUFDLDJCQUEyQjtBQUFBLE1BQ3hDO0FBQUEsSUFDRjtBQUFBLElBQ0EsVUFBVTtBQUFBLE1BQ1IsVUFBVTtBQUFBLE1BQ1YsVUFBVSxDQUFDLFFBQVEsUUFBUSxNQUFNO0FBQUEsSUFDbkM7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
