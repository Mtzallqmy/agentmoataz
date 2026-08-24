import React, { useState } from "react";
import { Text } from "react-native";
import { Button, Card, Field, Screen, Title, ui } from "../components/AppUI";
import { useAgentRuntime } from "../services/AppAgentContext";

const builtins = ["read_file", "write_file", "delete_file", "list_tree", "search_text", "http_get", "http_request", "download_file"];
export default function Tools() { const { runtime } = useAgentRuntime(); const [url, setUrl] = useState(""); const [status, setStatus] = useState(""); return <Screen><Title hint="Every built-in and MCP tool passes PermissionEngine">Tools</Title>{builtins.map((name) => <Card key={name}><Text style={ui.body}>{name}</Text></Card>)}<Text style={ui.heading}>Remote MCP server</Text><Field value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="https://server.example/mcp" /><Button title="Connect and discover" onPress={() => void runtime.addMcpServer(url).then((count) => setStatus(`${count} MCP tools registered`)).catch((error) => setStatus(error.message))} />{status ? <Text style={ui.body}>{status}</Text> : null}</Screen>; }
