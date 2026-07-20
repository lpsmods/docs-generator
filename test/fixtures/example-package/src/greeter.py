class Greeter:
    """Greets users.

    Args:
        greeting (str): The greeting to use
        punctuation (str): Ending punctuation
    """

    greeting: str
    punctuation: str

    def greet(self, name: str):
        """Returns a greeting."""
        return f"Hello {name}"

    def wave(self):
        pass

    def _whisper(self):
        pass


def get_bedrock_link(xuid: int):
    """Get a linked Java account from Bedrock xuid

    Args:
        xuid (int): Bedrock xuid
    """
    return xuid


def verify_online_link(value: str):
    return value


def _private_helper(value: str):
    return value


class _InternalGreeter:
    def public_inside_private(self):
        pass
