import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "portfolio-tracker",
		compatibilityDate: "2026-10-06",
		entrypoint,
		env: {
			DB: bindings.d1({ id: "9b80d9c1-fe09-4c43-ae12-e30c04dbb0ae", name: "portfolio-tracker" }),
			DASHBOARD_KEY: bindings.secret(),
		},
	},
});
