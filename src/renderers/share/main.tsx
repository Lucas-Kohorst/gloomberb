/** @jsxImportSource react */
import "./styles.css";
import { createRoot } from "react-dom/client";
import { SocialShareApp } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<SocialShareApp />);
