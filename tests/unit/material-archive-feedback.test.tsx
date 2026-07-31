import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveMaterialAction: vi.fn(),
  unarchiveMaterialAction: vi.fn(),
  reportLifecycle: vi.fn(),
}));

vi.mock("../../src/server/actions/materials", () => ({
  archiveMaterialAction: mocks.archiveMaterialAction,
  unarchiveMaterialAction: mocks.unarchiveMaterialAction,
}));

vi.mock("../../src/app/materials/MaterialsArchiveFeedback", () => ({
  useMaterialArchiveFeedback: () => ({ reportLifecycle: mocks.reportLifecycle }),
}));

import { MaterialArchiveControl } from "../../src/app/materials/MaterialArchiveControl";

const ARCHIVED = { id: "material-1", name: "Soy wax", archived: true } as const;
const ACTIVE = { id: "material-2", name: "Coconut wax", archived: false } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.archiveMaterialAction.mockResolvedValue({ status: "success", materialId: "material-2" });
  mocks.unarchiveMaterialAction.mockResolvedValue({ status: "success", materialId: "material-1" });
});

function mockConfirm(value: boolean) {
  return vi.spyOn(window, "confirm").mockReturnValue(value);
}

// R3-001 + R3-003: the lifecycle intent must be captured at dispatch so the
// status verb matches the operation the user performed, never the prop after
// revalidation. The control delegates feedback to a parent provider so the
// message survives row unmount.
describe("MaterialArchiveControl lifecycle reporting", () => {
  it("reports an archive operation captured at dispatch even after revalidation flips the prop", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    const { rerender } = render(<MaterialArchiveControl material={ACTIVE} />);

    await user.click(screen.getByRole("button", { name: "Archivar Coconut wax" }));

    // Simulate post-revalidation re-render where the same material is now archived.
    rerender(
      <MaterialArchiveControl material={{ id: ACTIVE.id, name: ACTIVE.name, archived: true }} />,
    );

    await waitFor(() =>
      expect(mocks.reportLifecycle).toHaveBeenCalledWith({
        operation: "archive",
        materialName: "Coconut wax",
      }),
    );
    confirmSpy.mockRestore();
  });

  it("reports a restore operation captured at dispatch even after revalidation flips the prop", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MaterialArchiveControl material={ARCHIVED} />);

    await user.click(screen.getByRole("button", { name: "Restaurar Soy wax" }));

    rerender(
      <MaterialArchiveControl
        material={{ id: ARCHIVED.id, name: ARCHIVED.name, archived: false }}
      />,
    );

    await waitFor(() =>
      expect(mocks.reportLifecycle).toHaveBeenCalledWith({
        operation: "restore",
        materialName: "Soy wax",
      }),
    );
  });

  it("does not render a row-scoped success status (parent owns the announcement)", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    render(<MaterialArchiveControl material={ACTIVE} />);

    await user.click(screen.getByRole("button", { name: "Archivar Coconut wax" }));

    expect(mocks.reportLifecycle).toHaveBeenCalled();
    // The control itself must NOT render the role=status region to avoid
    // double-announcements and stale copy if the row unmounts.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
