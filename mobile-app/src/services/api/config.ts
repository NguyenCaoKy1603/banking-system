const DEFAULT_API_URL = "http://10.0.2.2:5000/api/v1";

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_URL;

export const apiConfig = {
  baseUrl: API_URL,
} as const;
