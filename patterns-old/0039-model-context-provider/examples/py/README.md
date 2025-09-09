# Python Context Management Example

This repository contains an example implementation of a context management system using Python. The example demonstrates how to structure your code to manage different user contexts, such as nutrition, fitness, and mental wellness, by utilizing a provider pattern.

## Architecture and Design

The architecture of this example is based on the **Provider Pattern**, which allows for the separation of concerns by encapsulating the logic for fetching different types of user context data into distinct classes. This design promotes flexibility and scalability, making it easy to add or modify context providers without affecting the overall system.

### Key Components

1. **ContextProvider Interface**: This interface defines the contract for all context providers. Each provider must implement the `get_context` method, which takes a `user_id` and returns a dictionary containing the relevant context data.

2. **Concrete Context Providers**:
   - **NutritionContextProvider**: Fetches user dietary preferences.
   - **FitnessContextProvider**: Fetches user physical activity data.
   - **MentalWellnessContextProvider**: Fetches user mental wellness data.

3. **ContextManager**: This class is responsible for managing the different context providers. It instantiates each provider and aggregates the context data into a single dictionary when the `get_context` method is called.

4. **Main Function**: The entry point of the application where the `ContextManager` is instantiated, and the user context is fetched and logged.

## Implementation

The main Python file (`main.py`) contains the implementation of the context management system. Here’s a brief overview of how the components interact:

- Each context provider implements the `ContextProvider` interface, ensuring a consistent method signature for fetching context data.
- The `ContextManager` class holds instances of each context provider and uses them to compile a comprehensive context object for a given user.

### Example Code Snippet

Here is a simplified version of how the `ContextManager` aggregates data:

