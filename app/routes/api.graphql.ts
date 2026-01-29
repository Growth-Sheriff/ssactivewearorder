import { makeExecutableSchema } from "@graphql-tools/schema";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { createYoga } from "graphql-yoga";
import { resolvers } from "../graphql/resolvers";
import { typeDefs } from "../graphql/schema";

const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Request, Response, fetch },
});

export async function loader({ request }: LoaderFunctionArgs) {
  return yoga.handleRequest(request, {});
}

export async function action({ request }: ActionFunctionArgs) {
  return yoga.handleRequest(request, {});
}
