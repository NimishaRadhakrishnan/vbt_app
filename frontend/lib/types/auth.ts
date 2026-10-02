export type Role = "admin" | "manager" | "sales_officer" | "field_officer" | "dealer" | "farmer";

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  role: string;
  employee_id?: string;
  device_id?: string;
}

export interface RegisterResponse {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  employee_id?: string;
}

export interface LoginRequest {
  email?: string;
  employee_id?: string;
  password: string;
  device_id?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  employee_id?: string;
  device_id?: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  request_id?: string;
}
