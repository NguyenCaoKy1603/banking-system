import {
  canTransitionTransfer,
  transitionTransfer,
} from "@/features/transfers/domain/transferStateMachine";

describe("transferStateMachine", () => {
  it("cho phép pending đi đến trạng thái xử lý cuối", () => {
    expect(canTransitionTransfer("PENDING", "SUCCEEDED")).toBe(true);
    expect(canTransitionTransfer("PENDING", "FAILED")).toBe(true);
    expect(canTransitionTransfer("PENDING", "REVERSED")).toBe(true);
  });

  it("không cho phép giao dịch terminal quay lại pending", () => {
    expect(canTransitionTransfer("SUCCEEDED", "PENDING")).toBe(false);
    expect(canTransitionTransfer("FAILED", "REVERSED")).toBe(false);
    expect(() => transitionTransfer("SUCCEEDED", "PENDING")).toThrow(
      "Không thể chuyển trạng thái giao dịch",
    );
  });

  it("cho phép event lặp cùng trạng thái mà không tạo transition mới", () => {
    expect(transitionTransfer("PENDING", "PENDING")).toBe("PENDING");
    expect(transitionTransfer("SUCCEEDED", "SUCCEEDED")).toBe("SUCCEEDED");
  });
});
