import React, { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime } from "../services/AppAgentContext";

const builtins = [
  "read_file", "read_range", "write_file", "create_directory", "delete_file",
  "copy_file", "move_file", "list_tree", "search_text", "replace_text",
  "file_metadata", "hash_file", "diff_files", "create_zip",
  "http_get", "http_request", "download_file",
];

export default function Tools() {
  const { runtime } = useAgentRuntime();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  return <Screen>
    <Title hint="Every built-in and MCP tool passes PermissionEngine">Tools</Title>
    {builtins.map((name) => <Card key={name}><Text style={ui.body}>{name}</Text></Card>)}
    <Text style={ui.heading}>Remote MCP server</Text>
    <Field value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="https://server.example/mcp" />
    <Button title="Connect and discover" disabled={!url.trim()} onPress={() => void runtime.addMcpServer(url.trim()).then((count) => setStatus(`${count} MCP tools registered`)).catch((error) => setStatus(error instanceof Error ? error.message : String(error)))} />
    {status ? <Text style={ui.body}>{status}</Text> : null}
  </Screen>;
}
