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
const app = new Hono<AppType>()

function createSuperMemory(userId: string, env: Env) {

    const supermemory = new Supermemory({
        apiKey: (env as any).SUPERMEMORY_API_KEY,
    })

    app.post(
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

            if (!userId) {
                return c.json<ToolResponseType>(
                    [{ type: "text", text: "User ID is required" }],
                    400,
                )
            }

            const { memories } = await supermemory.memories.list({
                containerTags: [userId],
            })

            // if memories.length is more than 2000, reject with error.
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

    app.post(
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

            console.log("SEARCHING WITH USER ID", userId)
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

    return app
}

export class MyDurableObject extends DurableObject<Env> {
    transport?: SSEHonoTransport

    override async fetch(request: Request) {
        const url = new URL(request.url)
        const userId = url.pathname.split("/")[1] // Get userId from path

        // Initialize transport if not exists
        if (!this.transport) {
            this.transport = new SSEHonoTransport(
                `/${userId}/messages`,
                this.ctx.id.toString(),
            )
        }
        const server = new Hono<{
            Bindings: Env & { transport: SSEHonoTransport }
            Variables: { userId: string }
        }>()
            .basePath("/:userId")
            .use(async (c, next) => {
                const userId = c.req.param("userId")
                if (!userId) {
                    return c.json({ error: "User ID is required" }, 400)
                }
                c.set("userId", userId)
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
                    // logger: logger,
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

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url)

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                    "Access-Control-Max-Age": "86400",
                },
            })
        }

        if (url.pathname === "/oauth/register" && request.method === "POST") {
            try {
                const body = await request.json() as any
                const clientId = `sm_${Math.random().toString(36).substring(2, 15)}`
                const clientSecret = `sms_${Math.random().toString(36).substring(2, 25)}`
                
                const responseData = {
                    client_id: clientId,
                    client_secret: clientSecret,
                    client_name: body.client_name || "ChatGPT",
                    redirect_uris: body.redirect_uris || [],
                    scope: body.scope || "read write",
                    grant_types: ["authorization_code"],
                    response_types: ["code"],
                    token_endpoint_auth_method: "client_secret_basic",
                    client_id_issued_at: Math.floor(Date.now() / 1000),
                    client_secret_expires_at: 0,
                }

                return new Response(JSON.stringify(responseData), {
                    status: 201,
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                    },
                })
            } catch (error) {
                return new Response(JSON.stringify({ error: "invalid_request" }), {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                    },
                })
            }
        }

        // Handle the original failing MCP endpoint
        if (url.pathname === "/mcp" && request.method === "POST") {
            try {
                // Clone the request so we can read the body without consuming the original
                const clonedRequest = request.clone()
                const body = await clonedRequest.json() as any
                
                // Check if this is an OAuth registration request
                if (body.client_name || body.redirect_uris) {
                    const clientId = `sm_${Math.random().toString(36).substring(2, 15)}`
                    const clientSecret = `sms_${Math.random().toString(36).substring(2, 25)}`
                    
                    const responseData = {
                        client_id: clientId,
                        client_secret: clientSecret,
                        client_name: body.client_name || "ChatGPT",
                        redirect_uris: body.redirect_uris || [],
                        scope: body.scope || "read write",
                        grant_types: ["authorization_code"],
                        response_types: ["code"],
                        token_endpoint_auth_method: "client_secret_basic",
                        client_id_issued_at: Math.floor(Date.now() / 1000),
                        client_secret_expires_at: 0,
                    }

                    return new Response(JSON.stringify(responseData), {
                        status: 201,
                        headers: {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                        },
                    })
                } else {
                    // If not an OAuth request, return an error or handle appropriately
                    // Don't fall through to requestHandler as the body has been consumed
                    return new Response(JSON.stringify({ error: "unsupported_request_type" }), {
                        status: 400,
                        headers: {
                            "Content-Type": "application/json",
                            "Access-Control-Allow-Origin": "*",
                        },
                    })
                }
            } catch (error) {
                return new Response(JSON.stringify({ error: "invalid_request" }), {
                    status: 400,
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                    },
                })
            }
        }

        if (
            url.pathname.includes("sse") ||
            url.pathname.endsWith("/messages")
        ) {
            const sessionId = url.searchParams.get("sessionId")

            const namespace = env.MY_DO

            let stub: DurableObjectStub<MyDurableObject>

            if (sessionId) {
                const id = namespace.idFromString(sessionId)
                stub = namespace.get(id) as DurableObjectStub<MyDurableObject>
            } else {
                const id = namespace.newUniqueId()
                stub = namespace.get(id) as DurableObjectStub<MyDurableObject>
            }
            return stub.fetch(request)
        }

        const response = await requestHandler(request, {
            cloudflare: { env, ctx },
        })

        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
                ...Object.fromEntries(response.headers.entries()),
                ...corsHeaders,
            },
        })
    },
}
