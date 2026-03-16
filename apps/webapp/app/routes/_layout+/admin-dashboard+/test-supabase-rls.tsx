/* eslint-disable no-console */
import { useEffect, useState } from "react";
import { data, type LoaderFunctionArgs } from "react-router";
import { Button } from "~/components/shared/button";
import { supabaseClient } from "~/integrations/supabase/client";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const meta = () => [{ title: appendToMetaTitle("Test Supabase RLS") }];

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
};
export default function SecurityTest() {
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function testAccess() {
    setLoading(true);
    setResult("Testing...");

    let results = "";

    try {
      // Test 1: Basic select
      console.log("🔍 Test 1: Basic SELECT query");
      const { data, error } = await supabaseClient.from("User").select("*");

      results += `🔍 Test 1: Basic SELECT query\n`;
      if (error) {
        results += `✅ GOOD: Access denied - ${error.message}\n\n`;
        console.error("Access denied:", error.message);
      } else {
        if (data && data.length > 0) {
          results += `🚨 SECURITY ISSUE: Data accessible! Found ${data.length} records\n\n`;
          console.log("Data:", data);
        } else {
          results += `🤔 Query succeeded but returned 0 records\n`;
          results += `This could mean RLS is working or table is empty\n\n`;
          console.log("No data returned, but no error either");
        }
      }

      // Test 2: Try to check if table exists by counting
      console.log("🔍 Test 2: COUNT query to verify table access");
      results += `-------------------------\n`;
      results += `🔍 Test 2: COUNT query to verify table access\n`;
      const { count, error: countError } = await supabaseClient
        .from("User")
        .select("*", { count: "exact", head: true });

      if (countError) {
        results += `Count query error: ${countError.message}\n\n`;
      } else {
        results += `Count query result: ${count} records\n`;
        if (count === 0) {
          results += `• Table might be empty OR RLS is filtering everything\n\n`;
        } else {
          results += `🚨 SECURITY ISSUE: COUNT returned ${count} records.\n\n`;
        }
      }
    } catch (err: any) {
      results += `❌ Error: ${err.message}`;
      console.error("Test error:", err);
    } finally {
      setLoading(false);
      setResult(results);
    }
  }

  // Auto-run test on component mount
  useEffect(() => {
    void testAccess();
  }, []);

  return (
    <div style={{ padding: "20px", fontFamily: "monospace" }}>
      <h2>🔒 Supabase Security Test</h2>
      <p>Testing anonymous access to 'User' table...</p>

      <Button
        type="button"
        onClick={testAccess}
        disabled={loading}
        className={"my-4 font-mono"}
        variant={"secondary"}
      >
        {loading ? "Testing..." : "Run Security Test"}
      </Button>

      <div className="whitespace-pre-wrap rounded border border-gray-300 bg-gray-50 p-4">
        <strong>Result:</strong>
        <br />
        {result || "Click button to test"}
      </div>

      <div className="mt-5 text-[14px] text-gray-600">
        <h3>Understanding the Results:</h3>
        <ul>
          <li>
            <strong>✅ Secure:</strong> Errors like "permission denied", "JWT
            expired", or "insufficient privilege"
          </li>
          <li>
            <strong>🤔 Likely Secure:</strong> No error but 0 records returned
            (RLS probably working)
          </li>
          <li>
            <strong>🚨 Insecure:</strong> Actual data returned without
            authentication
          </li>
        </ul>

        <h3 className="mt-2">Next Steps if you see 0 records:</h3>
        <ol>
          <li>
            Check your Supabase dashboard - is RLS enabled on the User table?
          </li>
          <li>Verify records exist by querying as an authenticated user</li>
          <li>
            If count shows records exist but SELECT returns 0, RLS is working!
            ✅
          </li>
        </ol>
      </div>
    </div>
  );
}
