import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { Button } from "@/components/ui/Button";
import { TotpRequiredNotice } from "@/features/auth/components/TotpRequiredNotice";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("TotpRequiredNotice component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with default props and navigates to /mfa on button press", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TotpRequiredNotice />);
    });

    const button = renderer.root.findByType(Button);
    expect(button.props.label).toBe("Thiết lập mã TOTP ngay");

    await act(async () => {
      button.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith("/mfa");
  });

  it("calls custom onAction handler when provided", async () => {
    const customAction = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TotpRequiredNotice
          actionLabel="Tùy chỉnh"
          message="Thông báo riêng"
          onAction={customAction}
          title="Tiêu đề riêng"
        />,
      );
    });

    const button = renderer.root.findByType(Button);
    expect(button.props.label).toBe("Tùy chỉnh");

    await act(async () => {
      button.props.onPress();
    });

    expect(customAction).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
