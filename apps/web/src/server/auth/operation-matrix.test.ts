// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { MOUNTED_ROUTE_MATRIX, SENSITIVE_OPERATION_MATRIX, recentOperations } from "./operation-matrix";
const root = fileURLToPath(new URL("../../app/", import.meta.url)).replace(/\/$/, "");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(`${dir}/${e.name}`) : e.name === "route.ts" ? [`${dir}/${e.name}`] : []);
}
const methods = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
function inspect(source: string, expected: Readonly<Record<string, string>>) {
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const found: Record<string, string> = {};
  const authenticatedImport = ast.statements.some(s => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) &&
    s.moduleSpecifier.text === "@/server/http/route" && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) &&
    s.importClause.namedBindings.elements.some(e => e.name.text === "authenticated" && !e.propertyName));
  for (const s of ast.statements) {
    // Re-exports/spread exports are not reviewed route boundaries.
    if (ts.isExportDeclaration(s)) throw new Error("Unreviewed export");
    if (!ts.canHaveModifiers(s) || !ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(s) && s.name && methods.has(s.name.text)) {
      if (expected[s.name.text] === "local-account") {
        if (!source.includes('from "@/server/auth/local-account-mount"') || !s.body || s.body.statements.length!==1 || !ts.isReturnStatement(s.body.statements[0]!) || s.body.statements[0]!.getText(ast)!=="return localAccountMount(request);") throw new Error("Missing local mount gate");
        found[s.name.text]="local-account"; continue;
      }
      if (expected[s.name.text] !== "auth-special") throw new Error("Unwrapped route");
      found[s.name.text] = "auth-special";
    }
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !methods.has(d.name.text)) continue;
      const init = d.initializer;
      if (!authenticatedImport || !init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "authenticated") throw new Error("Missing request boundary");
      const option = init.arguments[0];
      if (!option || !ts.isObjectLiteralExpression(option)) throw new Error("Nonliteral policy");
      const requires = option.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === "requires");
      if (option.properties.some(p => ts.isSpreadAssignment(p))) throw new Error("Spread policy");
      if (requires && (!ts.isPropertyAssignment(requires) || !ts.isStringLiteral(requires.initializer))) throw new Error("Nonliteral capability");
      found[d.name.text] = requires && ts.isPropertyAssignment(requires) && ts.isStringLiteral(requires.initializer) ? requires.initializer.text : "member-session";
    }
  }
  expect(found).toEqual(expected);
}
it("classifies every mounted route/method and pins its actual request boundary", () => {
  const all = files(root);
  expect(all.map(f => f.slice(root.length + 1, -"/route.ts".length)).sort()).toEqual(Object.keys(MOUNTED_ROUTE_MATRIX).sort());
  for (const f of all) inspect(readFileSync(f, "utf8"), MOUNTED_ROUTE_MATRIX[f.slice(root.length + 1, -"/route.ts".length)]!);
});
it.each([
  'export const DELETE = authenticated({ requires: "household.delete" }, handler);',
  'export const GET = handler;',
  'export const GET = authenticated({ ...options }, handler);',
  'export const GET = authenticated({ requires: capability }, handler);',
  'export { GET } from "./unreviewed";',
  'export async function GET() {}',
])("guard detects unreviewed route mutation: %s", source => {
  expect(() => inspect('import { authenticated } from "@/server/http/route";\n' + source, { GET: "registry.read" })).toThrow();
});
it("worker/recovery/bootstrap paths cannot inherit ordinary recent-auth authority", () => {
  expect(recentOperations).not.toContain("household.irreversible-delete");
  expect(recentOperations).not.toContain("recovery.complete");
  expect(recentOperations).not.toContain("security.enroll");
  expect(SENSITIVE_OPERATION_MATRIX["identifier.reveal"].implementation).toBe("separate-reveal-review-required");
  expect(SENSITIVE_OPERATION_MATRIX["household.irreversible-delete"].implementation).toBe("final-receipt-disabled");
  for (const policy of Object.values(SENSITIVE_OPERATION_MATRIX)) expect(policy.instantSessionRevocation).toBe(false);
});

it("every ordinary capability has an explicit session policy and the wrapper invokes it around idempotency",async()=>{
  const {CAPABILITIES}=await import('./policy');
  const {CAPABILITY_SESSION_POLICY}=await import('./household-session');
  expect(Object.keys(CAPABILITY_SESSION_POLICY).sort()).toEqual([...Object.keys(CAPABILITIES),'member-session'].sort());
  const source=readFileSync(fileURLToPath(new URL('../http/route.ts',import.meta.url)),"utf8");
  expect(source).toContain('await withHouseholdSession(deps.db, ctx, principal!');
  expect(source.indexOf('await withHouseholdSession')).toBeLessThan(source.indexOf('withIdempotency({'));
});
it("SSR data and chooser use session admission",()=>{
  const layout=readFileSync(`${root}/(app)/layout.tsx`,"utf8");
  expect(layout).toContain('await withHouseholdSession(db,ctx,principal,token,provider,"registry.read"');
  expect(layout).toContain('householdOptions(db,principal,token,provider)');
  expect(layout).not.toContain('db.withPrincipal(');
});

// Every server action is an additional HTTP mutation boundary generated by Next.
// None is currently reviewed; a new directive requires explicit policy inventory.
function serverActions(source: string): number {
  const ast=ts.createSourceFile("candidate.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let count=0;
  const visit=(node:ts.Node)=>{
    if(ts.isExpressionStatement(node)&&ts.isStringLiteral(node.expression)&&node.expression.text==="use server")count++;
    ts.forEachChild(node,visit);
  };
  visit(ast);return count;
}
function sourceFiles(dir:string):string[] {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sourceFiles(`${dir}/${e.name}`):
    /\.[cm]?[jt]sx?$/.test(e.name)&&!e.name.includes(".test.")?[`${dir}/${e.name}`]:[]);
}
it("inventories all server-action directives rather than only known layouts",()=>{
  const src=fileURLToPath(new URL("../../",import.meta.url));
  expect(sourceFiles(src).filter(f=>serverActions(readFileSync(f,"utf8"))>0)).toEqual([]);
});
it.each([
  '"use server"; export async function change() {}',
  'export async function change() { "use server"; return mutate(); }',
  'const action=async()=>{ "use server"; return mutate(); };',
  String.raw`"use \u0073erver"; export async function change() {}`,
])("detects an unreviewed generated action boundary: %s",source=>{
  expect(serverActions(source)).toBe(1);
});
it("server-action inventory ignores comments and ordinary string data",()=>{
  expect(serverActions('// "use server";\nconst description="use server";')).toBe(0);
});
