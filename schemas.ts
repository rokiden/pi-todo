/**
 * TypeBox parameter schema for the todo tool
 */

import { Type } from "typebox";

const StatusEnum = Type.Unsafe({
	type: "string",
	enum: ["pending", "done"],
	description: "Task status: pending or done",
});

const ActionEnum = Type.Unsafe({
	type: "string",
	enum: ["add", "update", "toggle", "delete", "list", "clear", "reorder"],
	description: "Action to perform on the todo list",
});

const FilterEnum = Type.Unsafe({
	type: "string",
	enum: ["all", "pending", "done"],
	description: "Filter for list action: all, pending, or done",
});

const DirectionEnum = Type.Unsafe({
	type: "string",
	enum: ["up", "down"],
	description: "Reorder direction: up (earlier) or down (later)",
});

export const TodoParams = Type.Object({
	action: ActionEnum,
	id: Type.Optional(Type.String({ description: "Task ID (e.g. 00). Required for update, toggle, delete, reorder." })),
	text: Type.Optional(Type.String({ description: "Task description text. Required for add, optional for update." })),
	status: Type.Optional(StatusEnum),
	filter: Type.Optional(FilterEnum),
	direction: Type.Optional(DirectionEnum),
});
