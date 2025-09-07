# Python User Preferences and Browsing Behavior Example

This repository contains a Python example that demonstrates a simple architecture for managing user preferences and browsing behavior using context blocks. The design showcases how different components can interact to provide a cohesive user experience. This README will guide you through the architecture, implementation details, and how to extend the example for your own use cases.

## Architecture Overview

The example consists of three main components:

1. **UserPreferences**: This context block manages user preferences, allowing users to update their likes and dislikes.
2. **BrowsingBehavior**: This context block tracks the pages that users visit during their browsing sessions.
3. **ContextProvider**: This component acts as a mediator, coordinating interactions between the `UserPreferences` and `BrowsingBehavior` context blocks.

The architecture follows a simple observer pattern where changes in one context block can trigger updates in another, allowing for a responsive user interface that adapts to user behavior.

## Implementation Details

### UserPreferences

The `UserPreferences` class manages a list of preferences. It provides the following methods:

- `update_preferences(new_preference: str)`: Adds a new preference and notifies the `ContextProvider` to trigger any related updates.
- `get_preferences()`: Returns the current list of user preferences.

