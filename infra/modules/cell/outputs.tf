output "vpc_id" {
  value = aws_vpc.this.id
}

output "document_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "work_queue_url" {
  value = aws_sqs_queue.work.url
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "database_address" {
  value = aws_db_instance.postgres.address
}
