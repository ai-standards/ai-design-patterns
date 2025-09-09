from typing import List

class User:
    def __init__(self, username: str, age: int) -> None:
        """Initialize a User with a username and age."""
        self.username = username
        self.age = age

    def is_adult(self) -> bool:
        """Check if the user is an adult (18 years or older)."""
        return self.age >= 18


class UserManager:
    def __init__(self) -> None:
        """Initialize an empty list of users."""
        self.users: List[User] = []

    def add_user(self, user: User) -> None:
        """Add a new user to the user manager."""
        self.users.append(user)

    def get_adult_users(self) -> List[User]:
        """Return a list of adult users."""
        return [user for user in self.users if user.is_adult()]


def main() -> None:
    """Main function to demonstrate the UserManager functionality."""
    user_manager = UserManager()

    # Adding users
    user_manager.add_user(User("alice", 30))
    user_manager.add_user(User("bob", 17))
    user_manager.add_user(User("charlie", 22))

    # Getting adult users
    adult_users = user_manager.get_adult_users()
    for user in adult_users:
        print(f"Adult User: {user.username}, Age: {user.age}")


if __name__ == "__main__":
    main()
