import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequest, parseResponse } from "../helpers/request";
import { createMockSupabase, mockUser } from "../helpers/mock-supabase";

// ─── Mocks (vi.mock is hoisted above imports) ─────────────

const { supabase, mockTable, reset } = createMockSupabase();
const testUser = mockUser("user-1");

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ user: mockUser("user-1") }),
  getSessionUser: vi.fn().mockResolvedValue(mockUser("user-1")),
  unauthorized: () =>
    new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  forbidden: () =>
    new Response(JSON.stringify({ error: "Insufficient permissions" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => supabase,
}));

// ─── Route imports (resolved after vi.mock hoisting) ──────

import { GET as listFolders, POST as createFolder } from "@/app/api/folders/route";
import { GET as getFolder, PATCH as updateFolder, DELETE as deleteFolder } from "@/app/api/folders/[id]/route";
import { POST as archiveFolder } from "@/app/api/folders/[id]/archive/route";
import { GET as listItems, POST as addItems } from "@/app/api/folders/[id]/items/route";
import { DELETE as removeItem } from "@/app/api/folders/[id]/items/[itemId]/route";
import { GET as listNotes, POST as addNote } from "@/app/api/folders/[id]/items/[itemId]/notes/route";
import { GET as listComments, POST as addComment } from "@/app/api/folders/[id]/comments/route";
import { getFolderAccess, hasAccess } from "@/lib/folders";
import * as auth from "@/lib/auth";

// ─── Helpers ──────────────────────────────────────────────

beforeEach(() => {
  reset();
  // Reset auth to default user
  vi.mocked(auth.requireUser).mockResolvedValue({ user: testUser } as never);
});

function setUnauthenticated() {
  vi.mocked(auth.requireUser).mockResolvedValue({
    error: new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  } as never);
}

// ============================================================
// POST /api/folders — Create folder
// ============================================================

describe("POST /api/folders — create", () => {
  it("creates a folder with valid name", async () => {
    const folder = { id: 1, name: "Test", description: null, owner_id: "user-1", is_archived: false, item_count: 0 };
    mockTable("folders", { data: folder, error: null });

    const req = createRequest("POST", "/api/folders", { body: { name: "Test" } });
    const res = await createFolder(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.name).toBe("Test");
  });

  it("rejects empty name", async () => {
    const req = createRequest("POST", "/api/folders", { body: { name: "" } });
    const res = await createFolder(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain("Nazwa teczki jest wymagana");
  });

  it("rejects name longer than 200 chars", async () => {
    const req = createRequest("POST", "/api/folders", { body: { name: "A".repeat(201) } });
    const res = await createFolder(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });

  it("rejects unauthenticated users", async () => {
    setUnauthenticated();
    const req = createRequest("POST", "/api/folders", { body: { name: "Test" } });
    const res = await createFolder(req);
    expect(res.status).toBe(401);
  });
});

// ============================================================
// GET /api/folders — List folders
// ============================================================

describe("GET /api/folders — list", () => {
  it("returns owned folders with role=owner", async () => {
    mockTable("folders", {
      data: [{ id: 1, name: "Folder 1", owner_id: "user-1", is_archived: false, item_count: 3, updated_at: "2024-01-01" }],
      error: null,
    });
    mockTable("folder_shares", { data: [], error: null });

    const req = createRequest("GET", "/api/folders");
    const res = await listFolders(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    const folders = body.folders as Array<Record<string, unknown>>;
    expect(folders).toHaveLength(1);
    expect(folders[0].role).toBe("owner");
  });

  it("includes shared folders with correct role", async () => {
    mockTable("folders", { data: [], error: null }); // owned: none
    mockTable("folder_shares", {
      data: [{ folder_id: 99, permission: "read_write" }],
      error: null,
    });
    mockTable("folders", {
      data: [{ id: 99, name: "Shared", owner_id: "user-2", is_archived: false, updated_at: "2024-01-01" }],
      error: null,
    });
    mockTable("profiles", {
      data: [{ id: "user-2", email: "user-2@test.com" }],
      error: null,
    });

    const req = createRequest("GET", "/api/folders");
    const res = await listFolders(req);
    const { body } = await parseResponse(res);

    const folders = body.folders as Array<Record<string, unknown>>;
    expect(folders).toHaveLength(1);
    expect(folders[0].role).toBe("read_write");
    expect(folders[0].owner_email).toBe("user-2@test.com");
  });
});

// ============================================================
// GET /api/folders/[id] — Folder detail
// ============================================================

describe("GET /api/folders/[id] — detail", () => {
  const params = Promise.resolve({ id: "1" });

  it("returns folder for owner", async () => {
    mockTable("folders", {
      data: { id: 1, name: "My Folder", owner_id: "user-1", is_archived: false, item_count: 5 },
      error: null,
    });
    mockTable("profiles", { data: { email: "user-1@test.com" }, error: null });

    const req = createRequest("GET", "/api/folders/1");
    const res = await getFolder(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.name).toBe("My Folder");
    expect(body.role).toBe("owner");
  });

  it("returns folder for shared user", async () => {
    mockTable("folders", {
      data: { id: 1, name: "Shared Folder", owner_id: "user-2", is_archived: false },
      error: null,
    });
    mockTable("folder_shares", { data: { permission: "read" }, error: null });
    mockTable("profiles", { data: { email: "user-2@test.com" }, error: null });

    const req = createRequest("GET", "/api/folders/1");
    const res = await getFolder(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.role).toBe("read");
  });

  it("returns 404 for non-existent folder", async () => {
    mockTable("folders", { data: null, error: null });

    const req = createRequest("GET", "/api/folders/999");
    const res = await getFolder(req, { params: Promise.resolve({ id: "999" }) });
    const { status } = await parseResponse(res);

    expect(status).toBe(404);
  });

  it("returns 404 for user without access", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: null, error: null });

    const req = createRequest("GET", "/api/folders/1");
    const res = await getFolder(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(404);
  });

  it("rejects invalid folder ID", async () => {
    const req = createRequest("GET", "/api/folders/abc");
    const res = await getFolder(req, { params: Promise.resolve({ id: "abc" }) });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });
});

// ============================================================
// PATCH /api/folders/[id] — Update folder
// ============================================================

describe("PATCH /api/folders/[id] — update", () => {
  const params = Promise.resolve({ id: "1" });

  it("allows owner to update name", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folders", { data: null, error: null }); // update

    const req = createRequest("PATCH", "/api/folders/1", { body: { name: "New Name" } });
    const res = await updateFolder(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("rejects non-owner (even with read_write)", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read_write" }, error: null });

    const req = createRequest("PATCH", "/api/folders/1", { body: { name: "Hack" } });
    const res = await updateFolder(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
  });

  it("rejects empty name", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });

    const req = createRequest("PATCH", "/api/folders/1", { body: { name: "  " } });
    const res = await updateFolder(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });

  it("rejects empty update body", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });

    const req = createRequest("PATCH", "/api/folders/1", { body: {} });
    const res = await updateFolder(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });
});

// ============================================================
// DELETE /api/folders/[id] — Delete folder
// ============================================================

describe("DELETE /api/folders/[id]", () => {
  const params = Promise.resolve({ id: "1" });

  it("allows owner to delete", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folders", { data: null, error: null }); // delete

    const req = createRequest("DELETE", "/api/folders/1");
    const res = await deleteFolder(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("rejects non-owner", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read_write" }, error: null });

    const req = createRequest("DELETE", "/api/folders/1");
    const res = await deleteFolder(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
  });
});

// ============================================================
// POST /api/folders/[id]/archive — Toggle archive
// ============================================================

describe("POST /api/folders/[id]/archive", () => {
  const params = Promise.resolve({ id: "1" });

  it("archives a folder", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1", is_archived: false }, error: null });
    mockTable("folders", { data: null, error: null });

    const req = createRequest("POST", "/api/folders/1/archive", { body: { archived: true } });
    const res = await archiveFolder(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.is_archived).toBe(true);
  });

  it("unarchives a folder", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1", is_archived: true }, error: null });
    mockTable("folders", { data: null, error: null });

    const req = createRequest("POST", "/api/folders/1/archive", { body: { archived: false } });
    const res = await archiveFolder(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.is_archived).toBe(false);
  });

  it("rejects non-owner", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read_write" }, error: null });

    const req = createRequest("POST", "/api/folders/1/archive", { body: { archived: true } });
    const res = await archiveFolder(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
  });
});

// ============================================================
// POST /api/folders/[id]/items — Add items
// ============================================================

describe("POST /api/folders/[id]/items — add verdicts", () => {
  const params = Promise.resolve({ id: "1" });

  it("adds verdicts to folder", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1", item_count: 0 }, error: null });
    mockTable("verdicts", { data: [{ id: 10 }, { id: 20 }], error: null });
    mockTable("folder_items", { data: null, error: null }); // max pos
    mockTable("folder_items", { data: null, error: null }); // insert 10
    mockTable("folder_items", { data: null, error: null }); // insert 20

    const req = createRequest("POST", "/api/folders/1/items", {
      body: { verdict_ids: [10, 20], added_from: "search_results" },
    });
    const res = await addItems(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.added).toEqual([10, 20]);
    expect(body.skipped).toEqual([]);
  });

  it("handles duplicate items (unique constraint violation)", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1", item_count: 1 }, error: null });
    mockTable("verdicts", { data: [{ id: 10 }], error: null });
    mockTable("folder_items", { data: null, error: null }); // max pos
    mockTable("folder_items", { data: null, error: { code: "23505", message: "duplicate" } }); // insert fails

    const req = createRequest("POST", "/api/folders/1/items", { body: { verdict_ids: [10] } });
    const res = await addItems(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.added).toEqual([]);
    expect(body.skipped).toEqual([10]);
  });

  it("rejects empty verdict_ids", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });

    const req = createRequest("POST", "/api/folders/1/items", { body: { verdict_ids: [] } });
    const res = await addItems(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });

  it("rejects more than 100 items", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });

    const req = createRequest("POST", "/api/folders/1/items", {
      body: { verdict_ids: Array.from({ length: 101 }, (_, i) => i) },
    });
    const res = await addItems(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });

  it("rejects read-only shared user", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read" }, error: null });

    const req = createRequest("POST", "/api/folders/1/items", { body: { verdict_ids: [10] } });
    const res = await addItems(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
  });
});

// ============================================================
// DELETE /api/folders/[id]/items/[itemId] — Remove item
// ============================================================

describe("DELETE /api/folders/[id]/items/[itemId]", () => {
  const params = Promise.resolve({ id: "1", itemId: "42" });

  it("allows owner to remove item", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folder_items", { data: null, error: null });

    const req = createRequest("DELETE", "/api/folders/1/items/42");
    const res = await removeItem(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("allows read_write shared user", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read_write" }, error: null });
    mockTable("folder_items", { data: null, error: null });

    const req = createRequest("DELETE", "/api/folders/1/items/42");
    const res = await removeItem(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(200);
  });

  it("rejects read-only shared user", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read" }, error: null });

    const req = createRequest("DELETE", "/api/folders/1/items/42");
    const res = await removeItem(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
  });
});

// ============================================================
// POST /api/folders/[id]/items/[itemId]/notes — Add note
// ============================================================

describe("POST /api/folders/[id]/items/[itemId]/notes — add note", () => {
  const params = Promise.resolve({ id: "1", itemId: "42" });

  it("creates a note", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folder_items", { data: { id: 42 }, error: null });
    mockTable("folder_notes", {
      data: { id: 1, content: "Test note", author_id: "user-1", created_at: "2024-01-01" },
      error: null,
    });
    mockTable("profiles", { data: { email: "user-1@test.com" }, error: null });

    const req = createRequest("POST", "/api/folders/1/items/42/notes", { body: { content: "Test note" } });
    const res = await addNote(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.content).toBe("Test note");
  });

  it("rejects empty content", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folder_items", { data: { id: 42 }, error: null });

    const req = createRequest("POST", "/api/folders/1/items/42/notes", { body: { content: "" } });
    const res = await addNote(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });

  it("rejects note over 10000 chars", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folder_items", { data: { id: 42 }, error: null });

    const req = createRequest("POST", "/api/folders/1/items/42/notes", { body: { content: "A".repeat(10001) } });
    const res = await addNote(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });

  it("returns 404 for item not in folder", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folder_items", { data: null, error: null }); // not found

    const req = createRequest("POST", "/api/folders/1/items/42/notes", { body: { content: "Test" } });
    const res = await addNote(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(404);
  });
});

// ============================================================
// POST /api/folders/[id]/comments — Discussion
// ============================================================

describe("POST /api/folders/[id]/comments — discussion", () => {
  const params = Promise.resolve({ id: "1" });

  it("creates a folder-level comment", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });
    mockTable("folder_notes", {
      data: { id: 1, content: "Discussion", item_id: null, author_id: "user-1" },
      error: null,
    });
    mockTable("profiles", { data: { email: "user-1@test.com" }, error: null });

    const req = createRequest("POST", "/api/folders/1/comments", { body: { content: "Discussion" } });
    const res = await addComment(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.content).toBe("Discussion");
  });

  it("rejects empty comment", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });

    const req = createRequest("POST", "/api/folders/1/comments", { body: { content: "   " } });
    const res = await addComment(req, { params });
    const { status } = await parseResponse(res);

    expect(status).toBe(400);
  });
});

// ============================================================
// lib/folders.ts — getFolderAccess + hasAccess
// ============================================================

describe("getFolderAccess", () => {
  it("returns 'owner' when user owns the folder", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-1" }, error: null });

    const result = await getFolderAccess(supabase, 1, "user-1");
    expect(result.access).toBe("owner");
    expect(result.folder).toBeTruthy();
  });

  it("returns 'read_write' for shared user with write permission", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read_write" }, error: null });

    const result = await getFolderAccess(supabase, 1, "user-1");
    expect(result.access).toBe("read_write");
  });

  it("returns 'read' for shared user with read permission", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: { permission: "read" }, error: null });

    const result = await getFolderAccess(supabase, 1, "user-1");
    expect(result.access).toBe("read");
  });

  it("returns null for user without access", async () => {
    mockTable("folders", { data: { id: 1, owner_id: "user-2" }, error: null });
    mockTable("folder_shares", { data: null, error: null });

    const result = await getFolderAccess(supabase, 1, "user-1");
    expect(result.access).toBeNull();
    expect(result.folder).toBeNull();
  });

  it("returns null for non-existent folder", async () => {
    mockTable("folders", { data: null, error: null });

    const result = await getFolderAccess(supabase, 999, "user-1");
    expect(result.access).toBeNull();
    expect(result.folder).toBeNull();
  });
});

describe("hasAccess", () => {
  it("owner passes all checks", () => {
    expect(hasAccess("owner", "read")).toBe(true);
    expect(hasAccess("owner", "read_write")).toBe(true);
    expect(hasAccess("owner", "owner")).toBe(true);
  });

  it("read_write passes read and write checks", () => {
    expect(hasAccess("read_write", "read")).toBe(true);
    expect(hasAccess("read_write", "read_write")).toBe(true);
    expect(hasAccess("read_write", "owner")).toBe(false);
  });

  it("read passes only read check", () => {
    expect(hasAccess("read", "read")).toBe(true);
    expect(hasAccess("read", "read_write")).toBe(false);
    expect(hasAccess("read", "owner")).toBe(false);
  });

  it("null fails all checks", () => {
    expect(hasAccess(null, "read")).toBe(false);
    expect(hasAccess(null, "read_write")).toBe(false);
    expect(hasAccess(null, "owner")).toBe(false);
  });
});
