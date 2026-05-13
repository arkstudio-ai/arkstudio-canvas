/**
 * 认证相关类型定义
 */

// ==================== 用户信息类型 ====================

/**
 * 用户信息（来自后端 API）
 */
export interface UserInfo {
  id: string;
  email: string;
  username: string | null;
  avatar: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 登录响应
 */
export interface LoginResponse {
  user: UserInfo;
  token: string;
}

/**
 * 注册响应
 */
export interface RegisterResponse {
  user: UserInfo;
  token: string;
}

/**
 * 发送验证码请求参数
 */
export interface SendCodeParams {
  email: string;
  type: 'REGISTER' | 'RESET_PASSWORD' | 'VERIFY_EMAIL';
}

/**
 * 注册请求参数
 */
export interface RegisterParams {
  email: string;
  password: string;
  code: string; // 验证码
}

/**
 * 登录请求参数
 */
export interface LoginParams {
  email: string;
  password: string;
}

