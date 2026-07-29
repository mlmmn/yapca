import { beforeEach } from "vitest";
import { markIntegrationSlotsDirty } from "../fixtures/user";

// The plan's contract is "before each test, delete domain rows owned by the selected slot".
// The hook marks; `getIntegrationUserFixture` does the deleting on first use, so a test that
// touches no slot costs no round trip. Registering it here rather than per test file means a
// new integration file cannot forget it.
beforeEach(markIntegrationSlotsDirty);
