import { Tabs } from "expo-router";

import { colors } from "@/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700",
        },
        tabBarStyle: {
          height: 72,
          paddingTop: 6,
          paddingBottom: 8,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          elevation: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Trang chủ", tabBarButtonTestID: "tab-home" }}
      />
      <Tabs.Screen
        name="cards"
        options={{ title: "Thẻ", tabBarButtonTestID: "tab-cards" }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: "QR",
          tabBarButtonTestID: "tab-qr",
          tabBarItemStyle: {
            marginHorizontal: 4,
            marginVertical: 4,
            borderRadius: 18,
            backgroundColor: colors.primarySoft,
          },
          tabBarLabelStyle: {
            color: colors.primary,
            fontSize: 12,
            fontWeight: "800",
          },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Thêm", tabBarButtonTestID: "tab-profile" }}
      />
    </Tabs>
  );
}
