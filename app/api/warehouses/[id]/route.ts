import { createDetailRoute } from "@/lib/crud-route";

const handlers = createDetailRoute("WAREHOUSE");

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
