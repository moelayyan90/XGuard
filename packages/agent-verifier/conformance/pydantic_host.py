"""Run the local extension from a Pydantic AI agent using a deterministic model."""
import asyncio
import json
from pathlib import Path
import sys

from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStdio
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel


async def review(sample_path, policy_path):
    sample = json.loads(Path(sample_path).read_text())
    cli = Path(__file__).resolve().parents[1] / "extension.mjs"
    server = MCPServerStdio("node", [str(cli), policy_path], allow_sampling=False)
    observed = {}

    def model(messages, info):
        names = {tool.name for tool in info.function_tools}
        if names != {"review_offer", "verify_receipt"}:
            raise ValueError(f"unexpected tools: {names}")
        for part in messages[-1].parts:
            if isinstance(part, ToolReturnPart):
                value = part.content
                if isinstance(value, list):
                    value = value[0]
                if isinstance(value, dict) and "text" in value:
                    value = value["text"]
                if isinstance(value, str):
                    value = json.loads(value)
                observed[part.tool_name] = value
        if "review_offer" not in observed:
            return ModelResponse(parts=[ToolCallPart("review_offer", sample["offerInput"])])
        if "verify_receipt" not in observed:
            return ModelResponse(parts=[ToolCallPart("verify_receipt", sample["receiptInput"])])
        return ModelResponse(parts=[TextPart("Review complete.")])

    agent = Agent(FunctionModel(model), toolsets=[server])
    async with agent:
        await agent.run("Review the two public fixture artifacts.")
    return {"offer": observed["review_offer"], "receipt": observed["verify_receipt"]}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(review(*sys.argv[1:]))))
