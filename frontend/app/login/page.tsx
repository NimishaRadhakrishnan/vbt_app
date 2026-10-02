"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [username, setUsername] = useState(""); // Email or Employee ID
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const isEmail = username.includes("@");
      const loginPayload = isEmail 
        ? { email: username, password } 
        : { employee_id: username, password };
      
      // The account's role comes from the server and the dashboard already
      // renders per role, so there is nothing for the user to choose here.
      // The old "Select Your Role" dropdown defaulted to Field Officer and
      // rejected any correct password that did not match it - an admin
      // typing the right credentials was logged in, then straight back out
      // with "This account is registered as a Admin." It gated nothing
      // (roles are enforced server-side) and only ever cost a login.
      await login(loginPayload);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invalid email/employee ID or password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 bg-gradient-to-br from-green-50 to-slate-100">
      <div className="w-full max-w-md space-y-6 bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex justify-center mb-2">
            <img src="/logo.png" alt="Vishakan Biotech Logo" className="h-28 w-auto object-contain" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Vishakan Biotech</h1>
          <p className="text-sm font-medium text-slate-500">Field Force Operations Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Employee ID or Email
            </label>
            <input
              type="text"
              required
              autoComplete="username"
              placeholder="e.g. VB-1002 or email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent text-sm bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-16 border border-slate-200 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent text-sm bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-green-700 hover:text-green-800"
              >
                {showPassword ? "HIDE" : "SHOW"}
              </button>
            </div>
          </div>

          {error && <p className="text-sm font-semibold text-red-600 text-center">{error}</p>}

          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full bg-green-700 hover:bg-green-800 disabled:bg-green-600 text-white font-semibold py-2.5 rounded-lg transition shadow-md border-0 text-sm tracking-wide"
          >
            {isSubmitting ? "Signing in..." : "Log In"}
          </button>
        </form>

        <div className="text-center pt-2 space-y-2">
          <Link href="/forgot-password" className="text-xs font-bold text-green-700 hover:underline block">
            Forgot password?
          </Link>
          {/* The /privacy page already existed but nothing anywhere in
              the app linked to it - an orphaned page nobody can reach
              without typing the URL. Linking it here (pre-login, public)
              matters specifically because the Play Store Data Safety
              form expects a reachable live URL. */}
          <Link href="/privacy" className="text-xs text-slate-400 hover:text-slate-600 hover:underline block">
            Privacy Policy
          </Link>
        </div>
      </div>
    </main>
  );
}
