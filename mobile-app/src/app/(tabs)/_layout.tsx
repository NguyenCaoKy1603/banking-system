import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppIcon } from "@/components/ui/AppIcon";
import { colors, radius, shadows, sizes } from "@/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700",
        },
        tabBarStyle: {
          height: sizes.tabBarHeight,
          paddingTop: 8,
          paddingBottom: 10,
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          borderTopWidth: 1,
          ...shadows.card,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Trang chủ",
          tabBarButtonTestID: "tab-home",
          tabBarIcon: ({ color, size }) => <AppIcon color={color} name="home" size={size} />,
        }}
      />
      <Tabs.Screen
        name="cards"
        options={{
          title: "Thẻ",
          tabBarButtonTestID: "tab-cards",
          tabBarIcon: ({ color, size }) => <AppIcon color={color} name="card" size={size} />,
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: "QR",
          tabBarButtonTestID: "tab-qr",
          tabBarIcon: () => (
            <View style={styles.qrButton}>
              <AppIcon color={colors.onPrimary} name="qr" size={24} strokeWidth={2} />
            </View>
          ),
          tabBarItemStyle: {
            marginTop: -10,
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
        options={{
          title: "Thêm",
          tabBarButtonTestID: "tab-profile",
          tabBarIcon: ({ color, size }) => <AppIcon color={color} name="profile" size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  qrButton: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.surface,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    ...shadows.floating,
  },
});
