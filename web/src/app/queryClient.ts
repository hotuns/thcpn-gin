import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (failureCount >= 1) {
          return false;
        }
        return !(error instanceof ApiError && error.status === 401);
      }
    }
  }
});
