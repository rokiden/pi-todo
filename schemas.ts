/**
 * TypeBox parameter schema for the todo tool
 */

import { Type } from "typebox";

const StatusEnum = Type.Unsafe({
	type: "string",
	enum: ["pending", "in-progress", "done"],
	description: "Task status: pending, in-progress, or done",
});

const ActionEnum = Type.Unsafe({
	type: "string",
	enum: ["add", "update", "toggle", "remove", "list", "clear", "reorder"],
	description: "Action to perform on the todo list",
});

const FilterEnum = Type.Unsafe({
	type: "string",
	enum: ["all", "pending", "in-progress", "done", "blocked"],
	description: "Filter for list action: all, pending, in-progress, done, or blocked",
});

const DirectionEnum = Type.Unsafe({
	type: "string",
	enum: ["up", "down"],
	description: "Reorder direction: up (earlier) or down (later)",
});

export const TodoParams = Type.Object({
	action: ActionEnum,
	id: Type.Optional(Type.String({ description: "Task ID (e.g. 00). Required for update, toggle, remove, reorder." })),
	text: Type.Optional(Type.String({ description: "Task description text. Required for add, optional for update." })),
	status: Type.Optional(StatusEnum),
	filter: Type.Optional(FilterEnum),
	direction: Type.Optional(DirectionEnum),
});
