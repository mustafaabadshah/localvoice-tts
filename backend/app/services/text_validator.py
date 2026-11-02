import re
from fastapi import HTTPException, status
from app.config import settings

SENTENCE_SPLIT_REGEX = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9"\'])')

def validate_and_normalize_text(text: str) -> str:
    """Validates input text and normalizes whitespace without altering wording."""
    if not text or not text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Synthesis text cannot be empty or solely whitespace."
        )
    
    cleaned = text.strip()
    if len(cleaned) > settings.max_text_length:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Text length ({len(cleaned)} chars) exceeds maximum allowable limit of {settings.max_text_length} chars."
        )
    
    return cleaned

def split_into_sentence_chunks(text: str, max_chunk_len: int = 500) -> list[str]:
    """Splits long paragraphs into sentence chunks preserving exact order and wording."""
    if len(text) <= max_chunk_len:
        return [text]
    
    sentences = SENTENCE_SPLIT_REGEX.split(text)
    chunks = []
    current_chunk = []
    current_len = 0
    
    for s in sentences:
        s_len = len(s)
        if current_len + s_len + 1 > max_chunk_len and current_chunk:
            chunks.append(" ".join(current_chunk))
            current_chunk = [s]
            current_len = s_len
        else:
            current_chunk.append(s)
            current_len += s_len + 1
            
    if current_chunk:
        chunks.append(" ".join(current_chunk))
        
    return chunks if chunks else [text]
