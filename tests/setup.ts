import { vi } from "vitest";

// Mock rate limiter — always allow in tests
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => null,
}));
