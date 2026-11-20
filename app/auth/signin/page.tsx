"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DEMO_PASSWORD = "123456";

const DEMO_ACCOUNTS = [
  { label: "Administrator", username: "admin", role: "ADMIN" },
  { label: "Dispatcher", username: "dispatcher", role: "DISPATCHER" },
  { label: "Customer 1", username: "customer1", role: "CUSTOMER" },
  { label: "Customer 2", username: "customer2", role: "CUSTOMER" },
] as const;

type FieldErrors = { username?: string; password?: string };

export default function SignInPage() {
  const router = useRouter();
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);

  const validate = (username: string, password: string): FieldErrors => {
    const errors: FieldErrors = {};
    if (!username.trim()) {
      errors.username = "Username is required";
    } else if (username.trim().length < 3) {
      errors.username = "Username must be at least 3 characters";
    }
    if (!password) {
      errors.password = "Password is required";
    } else if (password.length < 6) {
      errors.password = "Password must be at least 6 characters";
    }
    return errors;
  };

  const signIn = async (username: string, password: string, pendingKey: string) => {
    const errors = validate(username, password);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError("");
    setPendingUser(pendingKey);

    try {
      const result = await fetch("/api/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = (await result.json()) as {
        success?: boolean;
        error?: string;
        user?: {
          id: number;
          username: string;
          role: string;
          name: string;
          customer_id: number | null;
        };
      };

      if (result.ok && data.success && data.user) {
        // Non-security display information only — the authoritative session
        // lives in the signed, httpOnly cc_session cookie.
        localStorage.setItem(
          "user",
          JSON.stringify({
            id: data.user.id,
            username: data.user.username,
            role: data.user.role,
            name: data.user.name,
            customer_id: data.user.customer_id,
          })
        );
        router.push("/");
        return;
      }

      setError(data.error || "Invalid credentials");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? `Login failed: ${err.message}`
          : "Login failed. Please try again."
      );
    } finally {
      setPendingUser(null);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void signIn(credentials.username, credentials.password, "form");
  };

  const busy = pendingUser !== null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500 text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 2v20" />
              <path d="M2 12h20" />
              <path d="M4.9 4.9l14.2 14.2" />
              <path d="M19.1 4.9L4.9 19.1" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-navy-900">Sign In</h1>
          <p className="mt-1 text-sm text-slate-500">
            ColdChain Logistics · Monitoring & Risk Analytics
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
          >
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="username" className="mb-2 block text-sm font-medium text-navy-900">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="Enter your username"
              value={credentials.username}
              onChange={(e) => {
                setCredentials({ ...credentials, username: e.target.value });
                setFieldErrors((prev) => ({ ...prev, username: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.username)}
              className={`w-full rounded-md border px-3 py-2 outline-none transition-colors focus:ring-2 focus:ring-teal-200 ${
                fieldErrors.username
                  ? "border-red-400 focus:border-red-500"
                  : "border-slate-300 focus:border-teal-500"
              }`}
            />
            {fieldErrors.username && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.username}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-navy-900">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={credentials.password}
              onChange={(e) => {
                setCredentials({ ...credentials, password: e.target.value });
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              className={`w-full rounded-md border px-3 py-2 outline-none transition-colors focus:ring-2 focus:ring-teal-200 ${
                fieldErrors.password
                  ? "border-red-400 focus:border-red-500"
                  : "border-slate-300 focus:border-teal-500"
              }`}
            />
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.password}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-navy-900 py-2 font-medium text-white transition-colors hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50">
            {pendingUser === "form" ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-500">or use a demo account</span>
            </div>
          </div>

          <p className="mt-4 text-center text-xs font-medium uppercase tracking-wider text-slate-400">
            Sign in as…
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.username}
                type="button"
                disabled={busy}
                onClick={() =>
                  void signIn(account.username, DEMO_PASSWORD, account.username)
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left transition-colors hover:border-teal-500 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50">
                <span className="block text-sm font-semibold text-navy-900">
                  {pendingUser === account.username ? "Signing in..." : account.label}
                </span>
                <span className="block text-[11px] text-slate-500">
                  {account.username} · {account.role}
                </span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-center text-xs text-slate-500">
            All demo accounts use password{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-navy-900">
              {DEMO_PASSWORD}
            </code>
          </p>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-400">
            Drivers are operational profiles in the system, not login accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
