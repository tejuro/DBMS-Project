/**
 * Compatibility stub. This project uses raw mysql2 against the existing
 * `cold_chain` schema; Prisma Client is not generated or required.
 * Importing this module is safe, but any Prisma operation fails loudly with a
 * clear message instead of a missing-module build error.
 */
const unavailable = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === "then") return undefined;
      throw new Error(
        `Prisma Client is not configured in this project. Use the mysql2 pool instead (attempted: ${String(property)}).`
      );
    },
  }
) as any;

const prisma: any = unavailable;

export default prisma;
export { prisma };
