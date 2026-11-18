# Files

What rides with a line: each file a chip with its name, its size, and a thumbnail if it is a picture.

- **Provide** `files`: `{ id, name, size, url }`. `size` is in bytes and reads as B, KB or MB; `url` is a picture's address.
- `onRemove` gives each chip its ×, for files still waiting to be sent. `onOpen` makes a picture's thumbnail a button: open it in an Opening hung from the chip.
- The Composer draws it for the files in your line. Under your words in a transcript it is the same chips without the ×.
- With no files it renders nothing.
