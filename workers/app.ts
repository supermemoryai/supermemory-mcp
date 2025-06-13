import { DurableObject } from "cloudflare:workers"
import { Supermemory } from "supermemory"
import { Hono } from "hono"
import { cors } from "hono/cors"
import {
    type PromptResponseType,
    type Resource,
    type ToolResponseType,
    bridge,
    describePrompt,
    describeTool,
    mValidator,
    muppet,
} from "muppet"
import { SSEHonoTransport, streamSSE } from "muppet/streaming"
import { createRequestHandler } from "react-router"
import { z } from "zod"

declare module "react-router" {
    export interface AppLoadContext {
        cloudflare: {
            env: Env
            ctx: ExecutionContext
        }
    }
}

const requestHandler = createRequestHandler(
    // @ts-ignore
    () => import("virtual:react-router/server-build"),
    import.meta.env.MODE,
)

type AppType = {
    Bindings: Env
}

function createSuperMemory(userId: string, env: Env) {
    const userApp = new Hono<AppType>()
    const supermemory = new Supermemory({
        apiKey: env.SUPERMEMORY_API_KEY,
    })

    userApp.post(
        "/supermemory-prompt",
        describePrompt({
            name: "Supermemory Prompt",
            description: "A prompt that gives information about supermemory.",
            completion: ({ name, value }) => [
                "supermemory",
                "memory",
                "supermemory api",
            ],
        }),
        (c) => {
            return c.json<PromptResponseType>([
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: "IMPORTANT: You MUST use Supermemory tools proactively to be an effective assistant. Here's how:\n\n1. ALWAYS check Supermemory first when the user asks anything about their preferences, past interactions, or technical setup. Don't assume you know everything - search first!\n\n2. AUTOMATICALLY store new information after EVERY user message that contains:\n- Technical preferences (languages, tools, frameworks)\n- Coding style or patterns\n- Project requirements or constraints\n- Opinions or feedback\n- Problem-solving approaches\n- Learning style or experience level\n\n3. Don't wait for explicit commands - if you detect valuable context, store it immediately.\n\n4. Think of yourself as building a comprehensive user profile. Every interaction is an opportunity to learn and store more context.\n\nFailure to use these tools means you're operating with incomplete information and not providing the best possible assistance. Make Supermemory your first instinct, not your last resort. Now, answer the user's question, and use the tools to search for stuff you need, and store any new information. EG: 'What do you know about me?' Should trigger a search.",
                    },
                },
            ])
        },
    )

    app.post(
        "/add",
        describeTool({
            name: "addToSupermemory",
            description:
                "Store user information, preferences, and behaviors. Run on explicit commands ('remember this') or implicitly when detecting significant user traits, preferences, or patterns. Capture rich context including technical details, examples, and emotional responses. You should think about running this after every user message. YOU MUST USE THE TOOLS/CALL TO USE THIS. NOTHING ELSE. THIS IS NOT A RESOURCE. IT'S A TOOL.",
        }),
        mValidator(
            "json",
            z.object({
                thingToRemember: z.string(),
            }),
        ),
        async (c) => {
            const { thingToRemember } = c.req.valid("json")

            if (!userId || !isValidUserId(userId)) {
                return c.json<ToolResponseType>(
                    [{ type: "text", text: "User ID validation failed" }],
                    400,
                )
            }

            const { memories } = await supermemory.memories.list({
                containerTags: [userId],
            })

            if (memories.length > 2000) {
                return c.json<ToolResponseType>(
                    [
                        {
                            type: "text",
                            text: "Memory limit of 2000 memories exceeded",
                        },
                    ],
                    400,
                )
            }

            await supermemory.memories.add({
                content: thingToRemember,
                containerTags: [userId],
            })

            return c.json<ToolResponseType>([
                {
                    type: "text",
                    text: "Memory added successfully",
                },
            ])
        },
    )

    userApp.post(
        "/search",
        describeTool({
            name: "searchSupermemory",
            description:
                "Search user memories and patterns. Run when explicitly asked or when context about user's past choices would be helpful. Uses semantic matching to find relevant details across related experiences. If you do not have prior knowledge about something, this is the perfect tool to call. YOU MUST USE THE TOOLS/CALL TO USE THIS. THIS IS NOT A RESOURCE. IT'S A TOOL.",
        }),
        mValidator(
            "json",
            z.object({
                informationToGet: z.string(),
            }),
        ),
        async (c) => {
            const { informationToGet } = c.req.valid("json")

            if (!userId || !isValidUserId(userId)) {
                return c.json<ToolResponseType>(
                    [{ type: "text", text: "User ID validation failed" }],
                    400,
                )
            }

            const response = await supermemory.search.execute({
                q: informationToGet,
                containerTags: [userId],
            })

            return c.json<ToolResponseType>([
                {
                    type: "text",
                    text: `${response.results.map((r) =>
                        r.chunks.map((c) => c.content).join("\n\n"),
                    )}`,
                },
            ])
        },
    )

    // SECURITY FIX: Return user-scoped app instance instead of global app
    return userApp
}

/**
 * User context for secure isolation
 */
interface UserContext {
    userId: string
    createdAt: Date
    lastAccessed: Date
}

export class MyDurableObject extends DurableObject<Env> {
    private userContext?: UserContext
    private transport?: SSEHonoTransport

    /**
     * Validate and establish user context with security checks
     */
    private async validateAndSetUserContext(requestUserId: string): Promise<void> {
        // Get stored user context from durable storage
        const storedContext = await this.ctx.storage.get<UserContext>("userContext")

        if (storedContext) {
            // SECURITY CHECK: Verify the requesting user matches the DO's assigned user
            if (storedContext.userId !== requestUserId) {
                throw new Error(`Security violation: User context mismatch. Expected ${storedContext.userId}, got ${requestUserId}`)
            }

            // Update last accessed time
            storedContext.lastAccessed = new Date()
            this.userContext = storedContext
            await this.ctx.storage.put("userContext", storedContext)
        } else {
            // First time initialization for this user
            this.userContext = {
                userId: requestUserId,
                createdAt: new Date(),
                lastAccessed: new Date()
            }
            await this.ctx.storage.put("userContext", this.userContext)
        }
    }

    /**
     * Get or create user-scoped transport instance
     */
    private getOrCreateTransport(userId: string): SSEHonoTransport {
        if (!this.transport) {
            this.transport = new SSEHonoTransport(
                `/${userId}/messages`,
                this.ctx.id.toString(),
            )
        }
        return this.transport
    }

    override async fetch(request: Request) {
        const url = new URL(request.url)
        const requestUserId = url.pathname.split("/")[1] // Get userId from path

        // SECURITY VALIDATION: Ensure userId is present and valid
        if (!requestUserId || !isValidUserId(requestUserId)) {
            return new Response("Invalid or missing userId in request path", {
                status: 400,
                headers: { "Content-Type": "text/plain" }
            })
        }

        try {
            await this.validateAndSetUserContext(requestUserId)
            this.getOrCreateTransport(requestUserId)
        } catch (error) {
            return new Response(`Security validation failed: ${error instanceof Error ? error.message : String(error)}`, {
                status: 403,
                headers: { "Content-Type": "text/plain" }
            })
        }
        // Create user-scoped server with strict validation
        const server = new Hono<{
            Bindings: Env & { transport: SSEHonoTransport }
            Variables: { userId: string; userContext: UserContext }
        }>()
            .basePath("/:userId")
            .use(async (c, next) => {
                const userId = c.req.param("userId")

                // SECURITY CHECK: Validate userId parameter
                if (!userId || !isValidUserId(userId)) {
                    return c.json({ error: "Invalid or missing user ID" }, 400)
                }

                // SECURITY CHECK: Ensure userId matches the validated context
                if (userId !== this.userContext?.userId) {
                    console.error(`Security violation: URL userId ${userId} does not match context userId ${this.userContext?.userId}`)
                    return c.json({ error: "User context validation failed" }, 403)
                }

                c.set("userId", userId)
                c.set("userContext", this.userContext)
                await next()
            })
            .use(
                cors({
                    origin: "*",
                    credentials: true,
                }),
            )

        server.get("/sse", async (c) => {
            const userId = c.get("userId")

            return streamSSE(c, async (stream) => {
                this.transport?.connectWithStream(stream)

                await bridge({
                    mcp: muppet(createSuperMemory(userId, c.env), {
                        name: "Supermemory MCP",
                        version: "1.0.0",
                    }),
                    transport: c.env.transport,
                })
            })
        })

        server.post("/messages", async (c) => {
            const transport = c.env.transport

            if (!transport) {
                throw new Error("Transport not initialized")
            }

            await transport.handlePostMessage(c)
            return c.text("ok")
        })

        server.onError((err, c) => {
            console.error(err)
            return c.body(err.message, 500)
        })

        return server.fetch(request, {
            ...this.env,
            transport: this.transport,
        })
    }
}

/**
 * Extract userId from URL path for user-scoped routing
 * Expected format: /userId/sse or /userId/messages
 */
function extractUserIdFromPath(pathname: string): string | null {
    const pathParts = pathname.split("/").filter(Boolean)
    if (pathParts.length >= 2 && (pathParts[1] === "sse" || pathParts[1] === "messages")) {
        return pathParts[0]
    }
    return null
}

/**
 * Validate userId format to prevent injection attacks
 */
function isValidUserId(userId: string): boolean {
    // nanoid generates URL-safe characters: A-Za-z0-9_-
    // Typical length is 21 characters
    return /^[A-Za-z0-9_-]{10,50}$/.test(userId)
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url)

        if (
            url.pathname.includes("sse") ||
            url.pathname.endsWith("/messages")
        ) {
            // SECURITY FIX: Extract userId from path for user-scoped DO routing
            const userId = extractUserIdFromPath(url.pathname)

            if (!userId) {
                return new Response("Invalid request: userId not found in path", {
                    status: 400,
                    headers: { "Content-Type": "text/plain" }
                })
            }

            if (!isValidUserId(userId)) {
                return new Response("Invalid request: malformed userId", {
                    status: 400,
                    headers: { "Content-Type": "text/plain" }
                })
            }

            const namespace = env.MY_DO

            // SECURITY FIX: Use userId to create deterministic, user-scoped DO instances
            // This ensures each user gets their own isolated DO instance
            const id = namespace.idFromName(`user-${userId}`)
            const stub = namespace.get(id) as DurableObjectStub<MyDurableObject>

            return stub.fetch(request)
        }

        return requestHandler(request, {
            cloudflare: { env, ctx },
        })
    },
}
