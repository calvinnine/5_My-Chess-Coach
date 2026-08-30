export async function register() {
  // Startup work touches SQLite and the filesystem, so it is Node-only. The
  // real work lives one module deeper so the Edge build never traces node:*.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runStartupTasks } = await import("@/lib/startup");
  runStartupTasks();
}
