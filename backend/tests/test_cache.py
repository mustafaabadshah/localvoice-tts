import tempfile
from pathlib import Path
from app.services.audio_cache import AudioCache

def test_cache_limit_and_eviction():
    with tempfile.TemporaryDirectory() as tmpdir:
        # Cache limited to 500 bytes
        cache = AudioCache(cache_dir=Path(tmpdir), max_bytes=500)
        
        # Insert 3 files of 200 bytes each (Total 600 bytes > 500 bytes limit)
        data1 = b"A" * 200
        data2 = b"B" * 200
        data3 = b"C" * 200
        
        cache.put("key1", data1)
        cache.put("key2", data2)
        cache.put("key3", data3)
        
        stats = cache.get_stats()
        # Total bytes must be strictly <= 500 bytes
        assert stats["total_bytes"] <= 500
        # Oldest file (key1) should have been evicted
        assert cache.get("key1") is None
        assert cache.get("key3") == data3

def test_cache_clear():
    with tempfile.TemporaryDirectory() as tmpdir:
        cache = AudioCache(cache_dir=Path(tmpdir), max_bytes=5000)
        cache.put("test_key", b"test_audio_data")
        assert cache.get("test_key") == b"test_audio_data"
        
        cleared_count = cache.clear()
        assert cleared_count == 1
        assert cache.get("test_key") is None
