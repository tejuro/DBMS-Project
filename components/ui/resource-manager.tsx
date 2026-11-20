"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface FormField {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "password";
  placeholder?: string;
  options?: SelectOption[];
  required?: boolean;
  step?: string;
  min?: number | string;
}

export interface TableColumn<T> {
  label: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
}

export type FormValues = Record<string, string | number>;

type Feedback = { kind: "success" | "error"; message: string } | null;

interface ResourceManagerProps<T extends object> {
  title: string;
  description?: string;
  resourceLabel: string;
  endpoint: string;
  idKey: keyof T;
  initialForm: FormValues;
  fields: FormField[];
  columns: TableColumn<T>[];
  toForm: (row: T) => FormValues;
  emptyMessage?: string;
  /** Optional archive/restore action. When provided, an Archive/Restore button
   * appears beside Edit/Delete on each row. Receives (id, isCurrentlyArchived). */
  onArchive?: (id: number, isArchived: boolean) => Promise<void>;
  archiveLabel?: (isArchived: boolean) => string;
  /** When false, Add/Edit/Delete controls are hidden (e.g. read-only roles).
   * API routes remain the authoritative permission check. Defaults to true. */
  canMutate?: boolean;
}

/**
 * Shared CRUD screen for the reference-data pages. Gives every resource the
 * same aligned layout, real Save/Cancel actions, response checking and
 * user-visible feedback instead of silent console-only failures.
 */
export function ResourceManager<T extends object>({
  title,
  description,
  resourceLabel,
  endpoint,
  idKey,
  initialForm,
  fields,
  columns,
  toForm,
  emptyMessage,
  onArchive,
  archiveLabel,
  canMutate = true,
}: ResourceManagerProps<T>) {
  const totalColumns = columns.length + (canMutate ? 1 : 0);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormValues>(initialForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(endpoint, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Could not load ${resourceLabel.toLowerCase()}s (HTTP ${response.status})`);
      }
      const data = await response.json();
      setRows(Array.isArray(data) ? (data as T[]) : []);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not load records.",
      });
    } finally {
      setLoading(false);
    }
  }, [endpoint, resourceLabel]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditing(null);
    setForm(initialForm);
  }, [initialForm]);

  const openCreate = () => {
    setFeedback(null);
    setEditing(null);
    setForm(initialForm);
    setShowForm(true);
  };

  const openEdit = (row: T) => {
    setFeedback(null);
    setEditing(Number(row[idKey]));
    setForm(toForm(row));
    setShowForm(true);
  };

  const archivableRowIsArchived = (row: T): boolean => {
    const archivableRow = row as T & { is_archived?: number | boolean };
    return Boolean(archivableRow.is_archived);
  };

  const changeValue = (field: FormField, raw: string) => {
    let value: string | number = raw;
    if (field.type === "number") {
      value = raw === "" ? "" : Number(raw);
    } else if (
      field.type === "select" &&
      field.options?.some((option) => typeof option.value === "number")
    ) {
      value = raw === "" ? "" : Number(raw);
    }
    setForm((current) => ({ ...current, [field.name]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch(editing === null ? endpoint : `${endpoint}/${editing}`, {
        method: editing === null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Save failed (HTTP ${response.status})`);
      }
      const wasEdit = editing !== null;
      closeForm();
      setFeedback({
        kind: "success",
        message: `${resourceLabel} ${wasEdit ? "updated" : "added"} successfully.`,
      });
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save record.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: T) => {
    const id = Number(row[idKey]);
    if (!window.confirm(`Delete ${resourceLabel} #${id}? This cannot be undone.`)) return;
    setDeletingId(id);
    setFeedback(null);
    try {
      const response = await fetch(`${endpoint}/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Delete failed (HTTP ${response.status})`);
      }
      setFeedback({ kind: "success", message: `${resourceLabel} #${id} deleted.` });
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not delete record.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleArchive = async (row: T) => {
    const id = Number(row[idKey]);
    if (!onArchive) return;
    const currentlyArchived = archivableRowIsArchived(row);
    const actionWord = currentlyArchived ? "restore" : "archive";
    if (!window.confirm(`${actionWord.charAt(0).toUpperCase() + actionWord.slice(1)} ${resourceLabel} #${id}?`)) return;
    setArchivingId(id);
    setFeedback(null);
    try {
      await onArchive(id, currentlyArchived);
      setFeedback({
        kind: "success",
        message: `${resourceLabel} #${id} ${actionWord}ed.`,
      });
      await load();
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : `Could not ${actionWord} record.`,
      });
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{title}</CardTitle>
              {description ? (
                <p className="mt-1 text-xs text-slate-500">{description}</p>
              ) : null}
            </div>
            {canMutate ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-200"
              >
                <span aria-hidden="true" className="text-base leading-none">+</span>
                Add {resourceLabel}
              </button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {feedback ? (
            <div
              role="status"
              className={cn(
                "mb-5 rounded-md border px-3 py-2 text-sm",
                feedback.kind === "success"
                  ? "border-teal-200 bg-teal-50 text-teal-800"
                  : "border-red-200 bg-red-50 text-red-700"
              )}
            >
              {feedback.message}
            </div>
          ) : null}

          {showForm ? (
            <form
              onSubmit={handleSubmit}
              className="mb-6 rounded-lg border border-slate-200 bg-slate-50/70 p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-navy-900">
                  {editing === null ? `Add ${resourceLabel}` : `Edit ${resourceLabel} #${editing}`}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    closeForm();
                    setFeedback(null);
                  }}
                  className="rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((field) => (
                  <div key={field.name}>
                    <label
                      htmlFor={`${endpoint}-${field.name}`}
                      className="mb-1 block text-xs font-medium text-slate-600"
                    >
                      {field.label}
                    </label>
                    {field.type === "select" ? (
                      <select
                        id={`${endpoint}-${field.name}`}
                        value={String(form[field.name] ?? "")}
                        onChange={(event) => changeValue(field, event.target.value)}
                        required={field.required !== false}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                      >
                        {(field.options ?? []).map((option) => (
                          <option key={String(option.value)} value={String(option.value)}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`${endpoint}-${field.name}`}
                        type={field.type ?? "text"}
                        step={field.step}
                        min={field.min}
                        placeholder={field.placeholder}
                        value={String(form[field.name] ?? "")}
                        onChange={(event) => changeValue(field, event.target.value)}
                        required={field.required !== false}
                        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    closeForm();
                    setFeedback(null);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving…" : editing === null ? `Add ${resourceLabel}` : "Save changes"}
                </button>
              </div>
            </form>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column.label}
                        className={cn(
                          "whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                          column.align === "right" ? "text-right" : ""
                        )}
                      >
                        {column.label}
                      </th>
                    ))}
                    {canMutate ? (
                      <th className="whitespace-nowrap px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Actions
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={totalColumns} className="px-4 py-10 text-center text-sm text-slate-500">
                        Loading…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={totalColumns} className="px-4 py-10 text-center text-sm text-slate-500">
                        {emptyMessage ?? `No ${resourceLabel.toLowerCase()}s recorded yet.`}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const id = Number(row[idKey]);
                      return (
                        <tr key={id} className="transition-colors hover:bg-slate-50/70">
                          {columns.map((column) => (
                            <td
                              key={column.label}
                              className={cn(
                                "px-4 py-3 align-middle text-slate-700",
                                column.align === "right" ? "text-right" : ""
                              )}
                            >
                              {column.cell(row)}
                            </td>
                          ))}
                          {canMutate ? (
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEdit(row)}
                                  className="rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(row)}
                                  disabled={deletingId === id}
                                  className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {deletingId === id ? "Deleting…" : "Delete"}
                                </button>
                                {onArchive ? (
                                  <button
                                    type="button"
                                    onClick={() => handleArchive(row)}
                                    disabled={archivingId === id}
                                    className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {archivingId === id
                                      ? "Working…"
                                      : archiveLabel
                                        ? archiveLabel(archivableRowIsArchived(row))
                                        : archivableRowIsArchived(row)
                                          ? "Restore"
                                          : "Archive"}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {!loading && rows.length > 0 ? (
            <p className="mt-3 text-xs text-slate-500">
              Showing {rows.length} {resourceLabel.toLowerCase()}{rows.length === 1 ? "" : "s"}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
