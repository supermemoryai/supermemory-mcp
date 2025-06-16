import type { MemoryListResponse } from "@supermemory/sdk/resources/memory.mjs"
import { useCallback, useEffect, useState, useRef } from "react"
import { useFetcher } from "react-router"
import logoMark from "./logomark.svg"

export function Welcome({
    message,
    userId,
    initialMemories,
}: {
    message: string
    userId: string
    initialMemories: MemoryListResponse.Memory[]
}) {
    const [selectedClient, setSelectedClient] = useState<string>("claude")
    const clients = [
        "claude",
        "cursor",
        "cline", 
        "roo-cline",
        "windsurf",
        "witsy",
        "enconvo",
    ]
    const currentUrl = "https://mcp.supermemory.ai"
    const [memories, setMemories] =
        useState<MemoryListResponse.Memory[]>(initialMemories)
    const [isDeleting, setIsDeleting] = useState<string | null>(null)
    const [isEditing, setIsEditing] = useState<string | null>(null)
    const [editedTitle, setEditedTitle] = useState<string>("")
    const [countdown, setCountdown] = useState<number>(30)
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
    const [restoreUrl, setRestoreUrl] = useState<string>("")
    const [isRestoring, setIsRestoring] = useState<boolean>(false)
    const [isExporting, setIsExporting] = useState<boolean>(false)
    const [exportError, setExportError] = useState<string | null>(null)
    const exportDropdownRef = useRef<HTMLDivElement>(null)
    const fetcher = useFetcher()

    // Create a function to fetch data
    const fetchMemories = useCallback(() => {
        setIsRefreshing(true)
        const formData = new FormData()
        formData.append("userId", userId)
        formData.append("action", "fetch") // Add action field for fetching
        fetcher.submit(formData, {
            method: "post",
            action: "/?index",
        })
        // Reset countdown when manually fetching
        setCountdown(30)
    }, [userId, fetcher])

    // Function to delete a memory
    const deleteMemory = (memoryId: string) => {
        if (!memoryId) return
        setIsDeleting(memoryId)
        // Updated to use useFetcher with action field
        const formData = new FormData()
        formData.append("userId", userId)
        formData.append("action", "delete")
        formData.append("memoryId", memoryId)
        fetcher
            .submit(formData, {
                method: "post",
                action: "/?index",
            })
            .then(() => {
                console.log(fetcher.data)
                if (fetcher.data.success === true) {
                    setMemories((prev :any) =>
                        prev.filter((memory :any) => memory.id !== memoryId),
                    )
                }
            })
    }

    // Function to start editing a memory
    const startEditing = (memory: MemoryListResponse.Memory) => {
        setIsEditing(memory.id)
        setEditedTitle(memory.title)
    }

    // Function to cancel editing
    const cancelEditing = () => {
        setIsEditing(null)
        setEditedTitle("")
    }

    // Function to restore a session from URL
    const restoreSession = async () => {
        if (!restoreUrl.trim()) {
            alert("Please enter a valid MCP URL")
            return
        }
        setIsRestoring(true)
        try {
            // Extract userId from URL
            // Expected format: https://mcp.supermemory.ai/USER_ID/sse or similar
            const urlPattern = /\/([^\/]+)\/sse/
            const match = restoreUrl.match(urlPattern)
            if (!match || !match[1]) {
                alert(
                    "Invalid URL format. Expected format: https://mcp.supermemory.ai/USER_ID/sse",
                )
                setIsRestoring(false)
                return
            }
            const extractedUserId = match[1]
            // Create form data for the restore action
            const formData = new FormData()
            formData.append("userId", extractedUserId)
            formData.append("action", "restore")
            fetcher.submit(formData, {
                method: "post",
                action: "/?index",
            })
            // Reset the input field
            setRestoreUrl("")
        } catch (error) {
            console.error("Error restoring session:", error)
            alert(
                `Failed to restore session: ${error instanceof Error ? error.message : String(error)}`,
            )
        } finally {
            setIsRestoring(false)
        }
    }

    // Function to update a memory
    const updateMemory = (memoryId: string) => {
        if (!memoryId || !editedTitle.trim()) return
        // Create form data for the update
        const formData = new FormData()
        formData.append("userId", userId)
        formData.append("action", "update")
        formData.append("memoryId", memoryId)
        formData.append("content", editedTitle.trim())
        fetcher
            .submit(formData, {
                method: "post",
                action: "/?index",
            })
            .then(() => {
                if (fetcher.data.success) {
                    // Update the memory in the local state
                    setMemories((prev:any) =>
                        prev.map((memory:any) =>
                            memory.id === memoryId
                                ? { ...memory, title: editedTitle.trim() }
                                : memory,
                        ),
                    )
                }
                // Reset editing state
                setIsEditing(null)
                setEditedTitle("")
            })
    }

    // Handle click outside to close dropdown
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
                setExportError(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleExport = async (format: "json" | "csv") => {
        if (!memories || memories.length === 0) {
            setExportError("No memories to export");
            return;
        }

        setIsExporting(true);
        setExportError(null);

        let blobUrl: string | null = null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

            const res = await fetch("/?index", {
                method: "POST",
                body: (() => {
                    const fd = new FormData();
                    fd.append("userId", userId);
                    fd.append("action", "export");
                    fd.append("format", format);
                    return fd;
                })(),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                const errorData :any = await res.json().catch(() => ({ error: "Unknown error" }));
                throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
            }

            const blob = await res.blob();
            if (blob.size === 0) {
                throw new Error("Received empty file");
            }

            // Clean up any existing blob URL
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
            }

            blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = `memories-${userId}-${new Date().toISOString()}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (error) {
            console.error("Export error:", error);
            setExportError(error instanceof Error ? error.message : "Failed to export memories");
        } finally {
            setIsExporting(false);
            // Clean up blob URL after a delay to ensure download has started
            if (blobUrl) {
                setTimeout(() => URL.revokeObjectURL(blobUrl!), 1000);
            }
        }
    };

    useEffect(() => {
        fetchMemories()
    }, [])

    // Countdown timer effect
    useEffect(() => {
        const timer = setInterval(() => {
            setCountdown((prev:any) => {
                if (prev <= 1) {
                    fetchMemories()
                    return 30
                }
                return prev - 1
            })
        }, 1000)
        return () => clearInterval(timer)
    }, [fetchMemories])

    // Handle fetcher data updates
    useEffect(() => {
        if (fetcher.data && fetcher.state === "idle") {
            // Handle successful response
            if (fetcher.data.memories) {
                setMemories(fetcher.data.memories)
            }
            // Handle error response
            if (fetcher.data.error) {
                console.error(
                    "Error with memory operation:",
                    fetcher.data.error,
                )
                alert(`Operation failed: ${fetcher.data.error}`)
            }
            // Reset deleting state if we were in the middle of a delete operation
            if (isDeleting) {
                setIsDeleting(null)
            }
            // Reset editing state if we were in the middle of an edit operation
            if (isEditing) {
                setIsEditing(null)
                setEditedTitle("")
            }
            // Reset refreshing state
            if (isRefreshing) {
                setIsRefreshing(false)
            }
        }
    }, [fetcher.data, fetcher.state])

    return (
        <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
            {/* Animated background elements */}
            <div className="absolute inset-0">
                <div className="absolute top-20 left-10 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse delay-700"></div>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-3xl animate-pulse delay-1000"></div>
            </div>

            {/* Subtle grid overlay */}
            <div className="absolute inset-0 bg-grid-pattern opacity-[0.02]"></div>

            {/* Top navigation */}
            <header className="relative w-full px-6 py-6 flex justify-between items-center backdrop-blur-sm border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <img src={logoMark} alt="Supermemory" className="w-8 h-8 relative z-10" />
                        <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-md"></div>
                    </div>
                    <span className="font-semibold text-white/90 text-lg">supermemory</span> 
                    <span className="text-blue-400 font-medium">mcp</span>
                </div>
                <div className="flex gap-8 text-sm">
                    <a
                        href="https://x.com/dhravyashah"
                        className="text-white/60 hover:text-white/90 transition-colors duration-300 hover:scale-105 transform"
                    >
                        X
                    </a>
                    <a
                        href="mailto:dhravya@supermemory.com"
                        className="text-white/60 hover:text-white/90 transition-colors duration-300 hover:scale-105 transform"
                    >
                        Contact us
                    </a>
                </div>
            </header>

            {/* Main content */}
            <div className="relative w-full max-w-7xl mx-auto px-6 md:px-8 mt-12">
                <div className="text-center mb-20">
                    <div className="relative flex items-center justify-center gap-4 mb-8">
                        <div className="relative">
                            <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/20 via-cyan-500/20 to-purple-500/20 rounded-2xl blur-xl"></div>
                            <div className="relative bg-gradient-to-r from-blue-500/10 to-cyan-500/10 backdrop-blur-sm border border-white/10 rounded-xl px-6 py-3">
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-400 font-medium">
                                    Powered by the{" "}
                                    <a
                                        href="https://docs.supermemory.ai"
                                        className="font-bold underline decoration-blue-400/50 hover:decoration-blue-400 transition-colors"
                                    >
                                        Supermemory API
                                    </a>
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    {/* Prominent API promotion section */}
                    <div className="flex flex-wrap justify-center gap-4 mb-8">
                        <a
                            href="https://supermemory.ai"
                            className="group relative bg-gradient-to-r from-blue-600/20 to-cyan-600/20 hover:from-blue-600/30 hover:to-cyan-600/30 border border-blue-500/30 hover:border-blue-500/50 transition-all duration-300 px-6 py-3 rounded-xl font-medium text-white/90 flex items-center gap-2"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-blue-400 group-hover:scale-110 transition-transform"
                            >
                                <path d="M12 2L2 7v10c0 5.55 3.84 9.74 9 11 5.16-1.26 9-5.45 9-11V7l-10-5z"/>
                            </svg>
                            <span className="group-hover:scale-105 transform transition-transform">
                                Explore Supermemory
                            </span>
                        </a>
                        <a
                            href="https://docs.supermemory.ai"
                            className="group relative bg-gradient-to-r from-purple-600/20 to-blue-600/20 hover:from-purple-600/30 hover:to-blue-600/30 border border-purple-500/30 hover:border-purple-500/50 transition-all duration-300 px-6 py-3 rounded-xl font-medium text-white/90 flex items-center gap-2"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-purple-400 group-hover:scale-110 transition-transform"
                            >
                                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                            </svg>
                            <span className="group-hover:scale-105 transform transition-transform">
                                API Documentation
                            </span>
                        </a>
                    </div>
                    <h1 className="font-space-grotesk tracking-tight text-6xl font-bold mb-6">
                        <span className="text-transparent bg-clip-text bg-gradient-to-b from-white via-white/90 to-white/70">
                            Your personal, universal{" "}
                        </span>
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-blue-400 italic">
                            memory
                        </span>
                        {" "}MCP
                    </h1>
                    <p className="text-lg text-white/60 mx-auto max-w-3xl leading-relaxed mb-8">
                        Everyone is adding their own memory layer - ChatGPT, Gemini, etc. etc. 
                        Why not carry it around *with* you? Build your own memory-powered applications with the 
                        <a href="https://docs.supermemory.ai" className="text-blue-400 hover:text-blue-300 font-medium underline decoration-blue-400/50 hover:decoration-blue-400 transition-colors mx-1">
                            Supermemory API
                        </a>
                        and join thousands of developers creating the future of personal AI.
                    </p>
                    
                    {/* Key features highlight */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 max-w-4xl mx-auto">
                        <div className="text-center group">
                            <div className="relative mb-4">
                                <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-lg group-hover:blur-xl transition-all duration-300"></div>
                                <div className="relative w-16 h-16 bg-gradient-to-r from-blue-600/20 to-cyan-600/20 rounded-full flex items-center justify-center border border-blue-500/30 mx-auto">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                                        <path d="M9 19c-5 0-8-3-8-6 0-3 3-6 8-6s8 3 8 6c0 3-3 6-8 6z"/>
                                        <path d="M15 12h6"/>
                                        <path d="M21 16l-3-4 3-4"/>
                                    </svg>
                                </div>
                            </div>
                            <h3 className="font-semibold text-white/90 mb-2">Universal Memory</h3>
                            <p className="text-sm text-white/60">Carry your context across all AI tools and applications</p>
                        </div>
                        
                        <div className="text-center group">
                            <div className="relative mb-4">
                                <div className="absolute inset-0 bg-purple-500/20 rounded-full blur-lg group-hover:blur-xl transition-all duration-300"></div>
                                <div className="relative w-16 h-16 bg-gradient-to-r from-purple-600/20 to-blue-600/20 rounded-full flex items-center justify-center border border-purple-500/30 mx-auto">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                                        <path d="M9 14l2 2 4-4"/>
                                    </svg>
                                </div>
                            </div>
                            <h3 className="font-semibold text-white/90 mb-2">Developer-First API</h3>
                            <p className="text-sm text-white/60">Simple, powerful API for building memory-enabled applications</p>
                        </div>
                        
                        <div className="text-center group">
                            <div className="relative mb-4">
                                <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-lg group-hover:blur-xl transition-all duration-300"></div>
                                <div className="relative w-16 h-16 bg-gradient-to-r from-cyan-600/20 to-blue-600/20 rounded-full flex items-center justify-center border border-cyan-500/30 mx-auto">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
                                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                                    </svg>
                                </div>
                            </div>
                            <h3 className="font-semibold text-white/90 mb-2">Lightning Fast</h3>
                            <p className="text-sm text-white/60">Optimized for speed with instant memory retrieval</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
                    {/* Left column - MCP URL */}
                    <div className="flex flex-col">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all duration-300"></div>
                            <div className="relative bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-white/10 p-8 hover:border-white/20 transition-all duration-300">
                                <h2 className="text-2xl font-semibold mb-2 text-white/90">
                                    Here's your MCP URL
                                </h2>
                                <p className="text-sm text-white/50 mb-8">Keep this secret</p>
                                
                                <div className="space-y-8">
                                    <div className="flex gap-2">
                                        <div className="flex-1 bg-slate-950/80 border border-white/10 rounded-xl p-4 font-mono text-sm overflow-x-auto">
                                            <code className="text-blue-300">
                                                {currentUrl}/{userId}/sse
                                            </code>
                                        </div>
                                        <button
                                            type="button"
                                            className="p-4 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 hover:border-blue-500/50 transition-all duration-300 flex items-center justify-center rounded-xl group"
                                            onClick={() => {
                                                navigator.clipboard.writeText(
                                                    `${currentUrl}/${userId}/sse`,
                                                )
                                            }}
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="18"
                                                height="18"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="text-blue-400 group-hover:scale-110 transition-transform"
                                            >
                                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                            </svg>
                                        </button>
                                    </div>

                                    <div>
                                        <h3 className="text-lg font-medium mb-4 text-white/80">
                                            Install it using this command
                                        </h3>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-sm text-white/60 mb-3 block">
                                                    Select Client:
                                                </label>
                                                <div className="flex flex-wrap gap-2">
                                                    {clients.map((client) => (
                                                        <button
                                                            key={client}
                                                            type="button"
                                                            onClick={() => setSelectedClient(client)}
                                                            className={`px-4 py-2 text-sm font-medium transition-all duration-300 rounded-lg border ${
                                                                selectedClient === client
                                                                    ? "bg-blue-600/30 border-blue-500/50 text-blue-300 shadow-lg shadow-blue-500/20"
                                                                    : "bg-slate-800/50 border-white/10 text-white/70 hover:bg-slate-800/80 hover:border-white/20"
                                                            }`}
                                                        >
                                                            {client}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="flex-1 bg-slate-950/80 border border-white/10 rounded-xl p-4 font-mono text-sm overflow-x-auto">
                                                    <code className="text-blue-300">
                                                        npx install-mcp i {currentUrl}/{userId}/sse --client {selectedClient}
                                                    </code>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="p-4 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 hover:border-blue-500/50 transition-all duration-300 flex items-center justify-center rounded-xl group"
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(
                                                            `npx install-mcp i ${currentUrl}/${userId}/sse --client ${selectedClient}`,
                                                        )
                                                    }}
                                                >
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        width="18"
                                                        height="18"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        className="text-blue-400 group-hover:scale-110 transition-transform"
                                                    >
                                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-4 pt-4">
                                        <a
                                            href="https://x.com/DhravyaShah/status/1912544778090414188"
                                            className="w-full bg-gradient-to-r from-blue-600/20 to-cyan-600/20 hover:from-blue-600/30 hover:to-cyan-600/30 border border-blue-500/30 hover:border-blue-500/50 transition-all duration-300 p-4 rounded-xl font-medium text-white/90 text-center group"
                                        >
                                            <span className="group-hover:scale-105 transform inline-block transition-transform">
                                                📺 See instruction video
                                            </span>
                                        </a>
                                        
                                        <a
                                            href="https://docs.supermemory.ai"
                                            className="w-full bg-gradient-to-r from-purple-600/20 to-blue-600/20 hover:from-purple-600/30 hover:to-blue-600/30 border border-purple-500/30 hover:border-purple-500/50 transition-all duration-300 p-4 rounded-xl font-medium text-white/90 text-center group flex items-center justify-center gap-2"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                                                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                                                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                                            </svg>
                                            <span className="group-hover:scale-105 transform inline-block transition-transform">
                                                📚 Explore API Documentation
                                            </span>
                                        </a>
                                        
                                        <a
                                            href="https://supermemory.ai"
                                            className="w-full bg-gradient-to-r from-orange-600/20 to-red-600/20 hover:from-orange-600/30 hover:to-red-600/30 border border-orange-500/30 hover:border-orange-500/50 transition-all duration-300 p-4 rounded-xl font-medium text-white/90 text-center group flex items-center justify-center gap-2"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400">
                                                <path d="M12 2L2 7v10c0 5.55 3.84 9.74 9 11 5.16-1.26 9-5.45 9-11V7l-10-5z"/>
                                            </svg>
                                            <span className="group-hover:scale-105 transform inline-block transition-transform">
                                                🚀 Visit Supermemory.ai
                                            </span>
                                        </a>
                                        
                                        <div className="mt-6">
                                            <h3 className="text-lg font-medium mb-4 text-white/80">
                                                Restore previous session
                                            </h3>
                                            <div className="flex flex-col gap-3">
                                                <input
                                                    type="text"
                                                    placeholder="Paste MCP URL here"
                                                    className="w-full bg-slate-950/80 border border-white/10 focus:border-blue-500/50 rounded-xl p-4 font-mono text-sm text-blue-300 placeholder-white/40 focus:outline-none transition-all duration-300"
                                                    onChange={(e) => setRestoreUrl(e.target.value)}
                                                    value={restoreUrl}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={restoreSession}
                                                    disabled={isRestoring}
                                                    className="w-full bg-gradient-to-r from-purple-600/20 to-blue-600/20 hover:from-purple-600/30 hover:to-blue-600/30 border border-purple-500/30 hover:border-purple-500/50 transition-all duration-300 p-4 rounded-xl font-medium text-white/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                                >
                                                    {isRestoring ? (
                                                        <>
                                                            <svg
                                                                xmlns="http://www.w3.org/2000/svg"
                                                                width="16"
                                                                height="16"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                strokeWidth="2"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                className="animate-spin"
                                                            >
                                                                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                                            </svg>
                                                            Restoring...
                                                        </>
                                                    ) : (
                                                        "Restore Session"
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right column - Memories */}
                    <div className="flex flex-col">
                        <div className="relative group h-full">
                            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all duration-300"></div>
                            <div className="relative bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-white/10 h-full hover:border-white/20 transition-all duration-300">
                                <div className="p-6 bg-slate-800/30 rounded-t-2xl flex justify-between items-center border-b border-white/10">
                                    <h2 className="text-xl font-semibold text-white/90">Memories</h2>
                                    <div className="flex items-center gap-3">
                                        <span className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
                                            {memories.length} items
                                        </span>
                                        {/* Export Button Dropdown */}
                                        <div className="relative group" ref={exportDropdownRef}>
                                            <button
                                                type="button"
                                                disabled={isExporting || memories.length === 0}
                                                className={`bg-blue-600/80 hover:bg-blue-700/90 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed ${
                                                    isExporting ? 'animate-pulse' : ''
                                                }`}
                                                aria-label={isExporting ? "Exporting memories..." : "Export memories"}
                                            >
                                                {isExporting ? (
                                                    <>
                                                        <svg className="animate-spin h-4 w-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                        </svg>
                                                        Exporting...
                                                    </>
                                                ) : (
                                                    <>
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" className="inline-block mr-1" aria-hidden="true">
                                                            <path d="M12 16v-8m0 8l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round"/>
                                                            <rect x="4" y="4" width="16" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                        </svg>
                                                        Export
                                                    </>
                                                )}
                                            </button>
                                            <div 
                                                className={`absolute right-0 mt-2 w-36 bg-slate-800 border border-white/10 rounded-lg shadow-lg transition-all duration-200 z-50 ${
                                                    isExporting ? 'opacity-50 pointer-events-none' : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto'
                                                }`}
                                                role="menu"
                                                aria-label="Export options"
                                            >
                                                <button
                                                    type="button"
                                                    disabled={isExporting}
                                                    className="block w-full text-left px-4 py-2 text-sm text-white/80 hover:bg-blue-600/20 rounded-t-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                                    onClick={() => handleExport("json")}
                                                    role="menuitem"
                                                >
                                                    Export as JSON
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isExporting}
                                                    className="block w-full text-left px-4 py-2 text-sm text-white/80 hover:bg-blue-600/20 rounded-b-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                                    onClick={() => handleExport("csv")}
                                                    role="menuitem"
                                                >
                                                    Export as CSV
                                                </button>
                                            </div>
                                            {exportError && (
                                                <div 
                                                    className="absolute right-0 mt-2 w-64 bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-400"
                                                    role="alert"
                                                >
                                                    {exportError}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {memories.length > 0 ? (
                                    <ul className="max-h-[500px] overflow-y-auto">
                                        {memories.map((memory, index) => (
                                            <li
                                                key={memory.id}
                                                className="px-6 py-4 hover:bg-slate-800/30 transition-all duration-300 border-b border-white/5 last:border-b-0 group/item"
                                                style={{
                                                    animationDelay: `${index * 50}ms`,
                                                    animation: 'fadeInUp 0.5s ease-out forwards'
                                                }}
                                            >
                                                <div className="flex flex-col gap-2">
                                                    {isEditing === memory.id ? (
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                value={editedTitle}
                                                                onChange={(e) => setEditedTitle(e.target.value)}
                                                                className="w-full bg-slate-950/80 border border-blue-500/50 rounded-lg px-3 py-2 text-sm text-white/90 focus:outline-none focus:border-blue-500"
                                                                autoFocus
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => updateMemory(memory.id)}
                                                                className="p-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded-lg text-green-400 transition-all duration-300"
                                                                title="Save changes"
                                                            >
                                                                <svg
                                                                    xmlns="http://www.w3.org/2000/svg"
                                                                    width="14"
                                                                    height="14"
                                                                    viewBox="0 0 24 24"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    strokeWidth="2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                >
                                                                    <path d="M20 6L9 17l-5-5" />
                                                                </svg>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={cancelEditing}
                                                                className="p-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 rounded-lg text-red-400 transition-all duration-300"
                                                                title="Cancel editing"
                                                            >
                                                                <svg
                                                                    xmlns="http://www.w3.org/2000/svg"
                                                                    width="14"
                                                                    height="14"
                                                                    viewBox="0 0 24 24"
                                                                    fill="none"
                                                                    stroke="currentColor"
                                                                    strokeWidth="2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                >
                                                                    <line x1="18" y1="6" x2="6" y2="18" />
                                                                    <line x1="6" y1="6" x2="18" y2="18" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <p className="text-white/80 break-words text-sm leading-relaxed">
                                                            {memory.summary}
                                                        </p>
                                                    )}
                                                    <div className="flex justify-between items-center">
                                                        <div className="text-xs text-blue-400/80 font-mono bg-blue-500/10 px-2 py-1 rounded">
                                                            ID: {memory.id.substring(0, 8)}...
                                                        </div>
                                                        <div className="opacity-0 group-hover/item:opacity-100 transition-all duration-300 flex gap-1">
                                                            {!isEditing && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => startEditing(memory)}
                                                                    className="p-2 hover:bg-blue-600/20 border border-transparent hover:border-blue-500/30 rounded-lg text-white/60 hover:text-blue-400 transition-all duration-300"
                                                                    title="Edit memory"
                                                                >
                                                                    <svg
                                                                        xmlns="http://www.w3.org/2000/svg"
                                                                        width="14"
                                                                        height="14"
                                                                        viewBox="0 0 24 24"
                                                                        fill="none"
                                                                        stroke="currentColor"
                                                                        strokeWidth="2"
                                                                        strokeLinecap="round"
                                                                        strokeLinejoin="round"
                                                                    >
                                                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                                    </svg>
                                                                </button>
                                                            )}
                                                            {!isEditing && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => deleteMemory(memory.id)}
                                                                    disabled={isDeleting === memory.id}
                                                                    className="p-2 hover:bg-red-600/20 border border-transparent hover:border-red-500/30 rounded-lg text-white/60 hover:text-red-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    title="Delete memory"
                                                                >
                                                                    {isDeleting === memory.id ? (
                                                                        <svg
                                                                            xmlns="http://www.w3.org/2000/svg"
                                                                            width="14"
                                                                            height="14"
                                                                            viewBox="0 0 24 24"
                                                                            fill="none"
                                                                            stroke="currentColor"
                                                                            strokeWidth="2"
                                                                            strokeLinecap="round"
                                                                            strokeLinejoin="round"
                                                                            className="animate-spin"
                                                                        >
                                                                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                                                        </svg>
                                                                    ) : (
                                                                        <svg
                                                                            xmlns="http://www.w3.org/2000/svg"
                                                                            width="14"
                                                                            height="14"
                                                                            viewBox="0 0 24 24"
                                                                            fill="none"
                                                                            stroke="currentColor"
                                                                            strokeWidth="2"
                                                                            strokeLinecap="round"
                                                                            strokeLinejoin="round"
                                                                        >
                                                                            <polyline points="3 6 5 6 21 6" />
                                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                                        </svg>
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="py-20 text-center flex flex-col items-center">
                                        <div className="relative mb-6">
                                            <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-lg"></div>
                                            <div className="relative w-16 h-16 rounded-full bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/30 flex items-center justify-center">
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    width="28"
                                                    height="28"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    className="text-blue-400"
                                                >
                                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                                </svg>
                                            </div>
                                        </div>
                                        <h3 className="text-lg font-semibold mb-2 text-white/90">
                                            No memories stored yet
                                        </h3>
                                        <p className="text-sm text-white/60 mb-6 max-w-sm">
                                            Start using the MCP to create your first memory and see the power of universal context
                                        </p>
                                        
                                        <div className="flex flex-col gap-3 w-full max-w-xs">
                                            <a
                                                href="https://docs.supermemory.ai"
                                                className="bg-gradient-to-r from-blue-600/20 to-cyan-600/20 hover:from-blue-600/30 hover:to-cyan-600/30 border border-blue-500/30 hover:border-blue-500/50 transition-all duration-300 px-4 py-3 rounded-xl font-medium text-white/90 text-center group flex items-center justify-center gap-2"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
                                                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                                                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                                                </svg>
                                                <span className="group-hover:scale-105 transform inline-block transition-transform text-sm">
                                                    Build something with the API
                                                </span>
                                            </a>
                                            
                                            <a
                                                href="https://supermemory.ai"
                                                className="bg-gradient-to-r from-purple-600/20 to-blue-600/20 hover:from-purple-600/30 hover:to-blue-600/30 border border-purple-500/30 hover:border-purple-500/50 transition-all duration-300 px-4 py-3 rounded-xl font-medium text-white/90 text-center group flex items-center justify-center gap-2"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                                                    <path d="M12 2L2 7v10c0 5.55 3.84 9.74 9 11 5.16-1.26 9-5.45 9-11V7l-10-5z"/>
                                                </svg>
                                                <span className="group-hover:scale-105 transform inline-block transition-transform text-sm">
                                                    Learn More
                                                </span>
                                            </a>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    )
}
