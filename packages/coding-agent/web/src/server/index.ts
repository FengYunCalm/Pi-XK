#!/usr/bin/env node
import { effectivePiWebConfig } from "../config.ts";
import { buildApp } from "./app.ts";

const app = await buildApp();
const { config } = effectivePiWebConfig();
await app.listen({ port: config.port ?? 8504, host: config.host ?? "127.0.0.1" });
