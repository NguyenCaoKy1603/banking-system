import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
} from "@/features/auth/types/auth";
import {
  isLoginResponse,
  isRegisterResponse,
} from "@/features/auth/services/authResponseValidators";
import { requestJson } from "@/services/api/httpClient";

export function login(request: LoginRequest): Promise<LoginResponse> {
  const body: LoginRequest = {
    email: request.email,
    password: request.password,
  };

  return requestJson<LoginResponse>("/auth/login", {
    method: "POST",
    body,
  }, isLoginResponse);
}

export function register(request: RegisterRequest): Promise<RegisterResponse> {
  const body: RegisterRequest = {
    fullName: request.fullName,
    email: request.email,
    phoneNumber: request.phoneNumber,
    password: request.password,
  };

  return requestJson<RegisterResponse>("/auth/register", {
    method: "POST",
    body,
  }, isRegisterResponse);
}

export const authApi = {
  login,
  register,
};
