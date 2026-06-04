import { describe, expect, it } from "vitest";
import { parseActionsConfigText } from "./config";

describe("workspace actions config", () => {
  it("parses a minimal version 1 config", () => {
    expect(parseActionsConfigText(JSON.stringify({
      version: 1,
      actions: [
        { id: "db.reset", title: "Reset DB", command: "go -C klingit-go run ./cli db reset" },
      ],
    }))).toEqual({
      ok: true,
      config: {
        version: 1,
        actions: [
          { id: "db.reset", title: "Reset DB", command: "go -C klingit-go run ./cli db reset", confirm: false },
        ],
      },
    });
  });

  it("parses optional group, description, and confirm fields", () => {
    expect(parseActionsConfigText(JSON.stringify({
      version: 1,
      actions: [
        {
          id: "docker.start",
          title: "Start Docker",
          description: "Start the dev stack.",
          group: "Docker",
          command: "./docker/scripts/docker-compose-dev up -d",
          confirm: true,
        },
      ],
    }))).toEqual({
      ok: true,
      config: {
        version: 1,
        actions: [
          {
            id: "docker.start",
            title: "Start Docker",
            description: "Start the dev stack.",
            group: "Docker",
            command: "./docker/scripts/docker-compose-dev up -d",
            confirm: true,
          },
        ],
      },
    });
  });

  it("accepts an empty actions array", () => {
    expect(parseActionsConfigText(JSON.stringify({ version: 1, actions: [] }))).toEqual({
      ok: true,
      config: { version: 1, actions: [] },
    });
  });

  it("rejects invalid JSON and unsupported versions", () => {
    expect(parseActionsConfigText("{")).toMatchObject({ ok: false });
    expect(parseActionsConfigText(JSON.stringify({ version: 2, actions: [] }))).toEqual({
      ok: false,
      error: "Config version must be 1",
    });
  });

  it("rejects missing, empty, or duplicate required fields", () => {
    expect(parseActionsConfigText(JSON.stringify({ version: 1 }))).toEqual({
      ok: false,
      error: "Config actions must be an array",
    });
    expect(parseActionsConfigText(JSON.stringify({ version: 1, actions: [{ id: "", title: "T", command: "cmd" }] }))).toEqual({
      ok: false,
      error: "Action 1 id must be a non-empty string",
    });
    expect(parseActionsConfigText(JSON.stringify({
      version: 1,
      actions: [
        { id: "one", title: "One", command: "cmd" },
        { id: "one", title: "Again", command: "cmd" },
      ],
    }))).toEqual({
      ok: false,
      error: "Duplicate action id: one",
    });
  });

  it("rejects invalid optional field types", () => {
    expect(parseActionsConfigText(JSON.stringify({ version: 1, actions: [{ id: "one", title: "One", command: "cmd", confirm: "yes" }] }))).toEqual({
      ok: false,
      error: "Action 1 confirm must be a boolean",
    });
    expect(parseActionsConfigText(JSON.stringify({ version: 1, actions: [{ id: "one", title: "One", command: "cmd", group: "" }] }))).toEqual({
      ok: false,
      error: "Action 1 group must be a non-empty string when provided",
    });
  });
});
